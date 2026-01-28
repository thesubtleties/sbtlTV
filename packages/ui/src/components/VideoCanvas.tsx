import { useEffect, useRef, useCallback } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

interface FrameData {
  width: number;
  height: number;
  y: number[];
  u: number[];
  v: number[];
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

// BT.709 YUV→RGB conversion
const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_textureY;
uniform sampler2D u_textureU;
uniform sampler2D u_textureV;
void main() {
  float y = texture(u_textureY, v_texCoord).r;
  float u = texture(u_textureU, v_texCoord).r - 0.5;
  float v = texture(u_textureV, v_texCoord).r - 0.5;
  // BT.709 matrix
  float r = y + 1.5748 * v;
  float g = y - 0.1873 * u - 0.4681 * v;
  float b = y + 1.8556 * u;
  fragColor = vec4(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0), 1.0);
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

function createTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function VideoCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<{
    gl: WebGL2RenderingContext;
    program: WebGLProgram;
    texY: WebGLTexture;
    texU: WebGLTexture;
    texV: WebGLTexture;
  } | null>(null);
  const rafRef = useRef<number>(0);
  const pendingFrame = useRef<FrameData | null>(null);

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

    // Bind texture units
    gl.uniform1i(gl.getUniformLocation(program, 'u_textureY'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_textureU'), 1);
    gl.uniform1i(gl.getUniformLocation(program, 'u_textureV'), 2);

    const texY = createTexture(gl)!;
    const texU = createTexture(gl)!;
    const texV = createTexture(gl)!;

    glRef.current = { gl, program, texY, texU, texV };
    console.log('[VideoCanvas] WebGL setup complete');
  }, []);

  const renderFrame = useCallback(() => {
    const frame = pendingFrame.current;
    const ctx = glRef.current;
    if (!frame || !ctx) {
      rafRef.current = requestAnimationFrame(renderFrame);
      return;
    }
    pendingFrame.current = null;

    const { gl, texY, texU, texV } = ctx;
    const { width, height } = frame;
    const halfW = width >> 1;
    const halfH = height >> 1;

    // Resize canvas if needed
    const canvas = canvasRef.current!;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }

    // Upload Y plane (full resolution)
    const yData = new Uint8Array(frame.y);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texY);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, yData);

    // Upload U plane (half resolution)
    const uData = new Uint8Array(frame.u);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texU);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, halfW, halfH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, uData);

    // Upload V plane (half resolution)
    const vData = new Uint8Array(frame.v);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texV);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, halfW, halfH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, vData);

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
      listen<FrameData>('mpv-frame', (event) => {
        pendingFrame.current = event.payload;
        frameCount++;
        // Log every 60 frames (~1 second at 60fps)
        if (frameCount % 60 === 1) {
          console.log(`[VideoCanvas] Received frame #${frameCount}: ${event.payload.width}x${event.payload.height}, Y[0]=${event.payload.y[0]}`);
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
