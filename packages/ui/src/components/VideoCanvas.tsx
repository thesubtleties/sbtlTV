import { useEffect, useRef, useCallback } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

interface FrameData {
  width: number;
  height: number;
  jpeg: string;  // base64 encoded JPEG
}

// Decode base64 to Uint8Array
function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

// Simple RGB passthrough shader (JPEG decodes to RGB)
const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_texture;
void main() {
  fragColor = texture(u_texture, v_texCoord);
}`;

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function VideoCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<{
    gl: WebGL2RenderingContext;
    program: WebGLProgram;
    texture: WebGLTexture;
  } | null>(null);
  const rafRef = useRef<number>(0);
  const pendingFrame = useRef<ImageBitmap | null>(null);
  const pendingSize = useRef<{ width: number; height: number } | null>(null);

  const initGL = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', { alpha: false, desynchronized: true });
    if (!gl) {
      console.error('[VideoCanvas] WebGL2 not supported');
      return;
    }
    console.log('[VideoCanvas] WebGL2 context created');

    // Clear to black immediately — undefined GPU memory can show as white
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const vertShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertShader || !fragShader) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    // Fullscreen quad
    const positions = new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1,
    ]);
    const texCoords = new Float32Array([
      0, 1,  1, 1,  0, 0,
      0, 0,  1, 1,  1, 0,
    ]);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const texBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    const texLoc = gl.getAttribLocation(program, 'a_texCoord');
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

    // Single texture for JPEG frames
    gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);

    const texture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    glRef.current = { gl, program, texture };
    console.log('[VideoCanvas] WebGL setup complete');
  }, []);

  const renderFrame = useCallback(() => {
    const bitmap = pendingFrame.current;
    const size = pendingSize.current;
    const ctx = glRef.current;

    if (!bitmap || !size || !ctx) {
      rafRef.current = requestAnimationFrame(renderFrame);
      return;
    }
    pendingFrame.current = null;
    pendingSize.current = null;

    const { gl, texture } = ctx;
    const { width, height } = size;

    // Resize canvas if needed
    const canvas = canvasRef.current!;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }

    // Upload ImageBitmap to texture (GPU-accelerated JPEG decode)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);

    // Clean up the ImageBitmap
    bitmap.close();

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Check for WebGL errors
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      console.error('[VideoCanvas] WebGL error:', error);
    }

    rafRef.current = requestAnimationFrame(renderFrame);
  }, []);

  useEffect(() => {
    initGL();
    rafRef.current = requestAnimationFrame(renderFrame);

    let unlisten: UnlistenFn | undefined;

    // Only listen for frames if running in Tauri
    if ('__TAURI_INTERNALS__' in window) {
      let frameCount = 0;
      listen<FrameData>('mpv-frame', async (event) => {
        const { width, height, jpeg } = event.payload;

        frameCount++;
        // Log every 60 frames (~2 seconds at 30fps)
        if (frameCount % 60 === 1) {
          console.log(`[VideoCanvas] Received frame #${frameCount}: ${width}x${height}, JPEG ${(jpeg.length / 1024).toFixed(1)}KB`);
        }

        try {
          // Decode base64 to bytes
          const bytes = decodeBase64(jpeg);

          // Create blob and decode JPEG using browser's GPU-accelerated decoder
          const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
          const bitmap = await createImageBitmap(blob);

          // Store for next render frame
          pendingFrame.current = bitmap;
          pendingSize.current = { width, height };
        } catch (err) {
          console.error('[VideoCanvas] Failed to decode frame:', err);
        }
      }).then((fn) => {
        unlisten = fn;
        console.log('[VideoCanvas] Listening for mpv-frame events');
      });
    } else {
      console.log('[VideoCanvas] Not in Tauri, skipping frame listener');
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      unlisten?.();
    };
  }, [initGL, renderFrame]);

  return (
    <canvas
      ref={canvasRef}
      className="video-canvas"
      width={1280}
      height={720}
    />
  );
}
