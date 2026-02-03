/**
 * VideoCanvas - Displays VideoFrames from Electron's sharedTexture API
 *
 * Uses WebGL for GPU-accelerated rendering with proper Y-flip handling.
 * D3D11 textures have top-left origin, OpenGL has bottom-left - we flip
 * in the vertex shader to correct this.
 */

import { useEffect, useRef, useCallback } from 'react';

interface VideoCanvasProps {
  /** Whether the canvas should be visible */
  visible: boolean;
  /** Optional CSS class name */
  className?: string;
  /** Flip video vertically (default: false - mpv already flips) */
  flipY?: boolean;
  /** Flip video horizontally (default: false) */
  flipX?: boolean;
}

// Vertex shader - positions a full-screen quad, optionally flips X/Y
const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
uniform bool u_flipY;
uniform bool u_flipX;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  float u = u_flipX ? 1.0 - a_texCoord.x : a_texCoord.x;
  float v = u_flipY ? 1.0 - a_texCoord.y : a_texCoord.y;
  v_texCoord = vec2(u, v);
}
`;

// Fragment shader - samples from video texture
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_texture;

void main() {
  fragColor = texture(u_texture, v_texCoord);
}
`;

interface WebGLState {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  vao: WebGLVertexArrayObject;
  flipYLocation: WebGLUniformLocation;
  flipXLocation: WebGLUniformLocation;
}

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[VideoCanvas] Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[VideoCanvas] Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function initWebGL(canvas: HTMLCanvasElement): WebGLState | null {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    desynchronized: true,  // Reduces latency
    powerPreference: 'high-performance',
  });

  if (!gl) {
    console.error('[VideoCanvas] WebGL2 not available');
    return null;
  }

  // Create shaders
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertexShader || !fragmentShader) return null;

  // Create program
  const program = createProgram(gl, vertexShader, fragmentShader);
  if (!program) return null;

  // Clean up shaders (attached to program, no longer needed)
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  // Get uniform locations
  const flipYLocation = gl.getUniformLocation(program, 'u_flipY');
  const flipXLocation = gl.getUniformLocation(program, 'u_flipX');
  if (!flipYLocation || !flipXLocation) {
    console.error('[VideoCanvas] Could not get uniform locations');
    return null;
  }

  // Create full-screen quad vertices
  // Position (x, y) and texCoord (u, v) interleaved
  const vertices = new Float32Array([
    // Position    // TexCoord
    -1.0, -1.0,    0.0, 0.0,  // Bottom-left
     1.0, -1.0,    1.0, 0.0,  // Bottom-right
    -1.0,  1.0,    0.0, 1.0,  // Top-left
     1.0,  1.0,    1.0, 1.0,  // Top-right
  ]);

  // Create VAO and VBO
  const vao = gl.createVertexArray();
  if (!vao) return null;
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  // Set up vertex attributes
  const positionLoc = gl.getAttribLocation(program, 'a_position');
  const texCoordLoc = gl.getAttribLocation(program, 'a_texCoord');

  gl.enableVertexAttribArray(positionLoc);
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 16, 0);

  gl.enableVertexAttribArray(texCoordLoc);
  gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 16, 8);

  // Create texture
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);

  // Set texture parameters for video
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  console.log('[VideoCanvas] WebGL2 initialized');

  return { gl, program, texture, vao, flipYLocation, flipXLocation };
}

export function VideoCanvas({ visible, className, flipY = false, flipX = false }: VideoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glStateRef = useRef<WebGLState | null>(null);
  const lastDimensionsRef = useRef({ width: 0, height: 0 });

  // Handle frame rendering with WebGL
  const handleFrame = useCallback((videoFrame: VideoFrame, _index: number) => {
    const canvas = canvasRef.current;
    const glState = glStateRef.current;

    if (!canvas || !glState) {
      videoFrame.close();
      return;
    }

    const { gl, program, texture, vao, flipYLocation, flipXLocation } = glState;
    const width = videoFrame.codedWidth;
    const height = videoFrame.codedHeight;

    // Resize canvas if video dimensions changed
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      lastDimensionsRef.current = { width, height };
      console.log(`[VideoCanvas] Resized to ${width}x${height}`);
    }

    // Upload VideoFrame to texture
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoFrame);

    // Draw
    gl.useProgram(program);
    gl.uniform1i(flipYLocation, flipY ? 1 : 0);
    gl.uniform1i(flipXLocation, flipX ? 1 : 0);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // IMPORTANT: Close the frame when done to prevent memory leaks
    videoFrame.close();
  }, [flipY, flipX]);

  // Initialize WebGL on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && !glStateRef.current) {
      glStateRef.current = initWebGL(canvas);
    }

    return () => {
      // Cleanup WebGL resources
      const glState = glStateRef.current;
      if (glState) {
        const { gl, program, texture, vao } = glState;
        gl.deleteTexture(texture);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(program);
        glStateRef.current = null;
      }
    };
  }, []);

  // Set up sharedTexture receiver
  useEffect(() => {
    if (!window.sharedTexture?.isAvailable) {
      console.log('[VideoCanvas] sharedTexture not available');
      return;
    }

    console.log('[VideoCanvas] Setting up WebGL frame receiver');
    window.sharedTexture.onFrame(handleFrame);

    return () => {
      console.log('[VideoCanvas] Removing frame receiver');
      window.sharedTexture?.removeFrameListener();
    };
  }, [handleFrame]);

  // Don't render if sharedTexture not available
  if (!window.sharedTexture?.isAvailable) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        display: visible ? 'block' : 'none',
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        backgroundColor: 'black',
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
