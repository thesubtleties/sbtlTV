/**
 * VideoCanvas - Displays VideoFrames from Electron's sharedTexture API
 *
 * Uses WebGL for GPU-accelerated rendering with proper Y-flip handling.
 * D3D11 textures have top-left origin, OpenGL has bottom-left - we flip
 * in the vertex shader to correct this.
 */

import { useEffect, useRef, useCallback } from 'react';
import { FramePacer } from '../hooks/framePacer';

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
  vbo: WebGLBuffer;
  flipYLocation: WebGLUniformLocation;
  flipXLocation: WebGLUniformLocation;
}

// Linux paces presentation (see framePacer.ts). Each arriving frame is copied
// into one of these textures and released at once, so queued frames hold GPU
// textures rather than the shared DMA-BUF slots mpv renders into.
interface PacedSlot {
  texture: WebGLTexture;
  width: number;
  height: number;
  arrivedAt: number;
}
// Queue limit plus the frame on screen plus the one being uploaded.
const PACED_MAX_DEPTH = 6;
const PACED_SLOT_COUNT = PACED_MAX_DEPTH + 2;

function createVideoTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

// Draw a full-screen quad sampling `texture`, resizing the canvas first.
function drawTextureQuad(
  state: WebGLState, canvas: HTMLCanvasElement, texture: WebGLTexture,
  width: number, height: number, flipY: boolean, flipX: boolean,
): void {
  const { gl, program, vao, flipYLocation, flipXLocation } = state;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
    console.log(`[VideoCanvas] Resized to ${width}x${height}`);
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.useProgram(program);
  gl.uniform1i(flipYLocation, flipY ? 1 : 0);
  gl.uniform1i(flipXLocation, flipX ? 1 : 0);
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.flush();
}

interface PresentStats {
  lastAt: number;
  intervals: number[];
  delaySum: number;
  delayCount: number;
}

function createPresentStats(): PresentStats {
  return { lastAt: 0, intervals: [], delaySum: 0, delayCount: 0 };
}

interface FrameCadenceStats {
  startedAt: number;
  lastFrameAt: number;
  lastFrameIndex: number;
  frames: number;
  outOfOrder: number;
  indexGaps: number;
  intervals: number[];
  drawMs: number;
  maxDrawMs: number;
}

function createFrameCadenceStats(): FrameCadenceStats {
  return {
    startedAt: 0,
    lastFrameAt: 0,
    lastFrameIndex: -1,
    frames: 0,
    outOfOrder: 0,
    indexGaps: 0,
    intervals: [],
    drawMs: 0,
    maxDrawMs: 0,
  };
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
  if (!vertexShader || !fragmentShader) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  // Create program
  const program = createProgram(gl, vertexShader, fragmentShader);

  // Clean up shaders (attached to program, no longer needed)
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!program) return null;

  // Get uniform locations
  const flipYLocation = gl.getUniformLocation(program, 'u_flipY');
  const flipXLocation = gl.getUniformLocation(program, 'u_flipX');
  if (!flipYLocation || !flipXLocation) {
    console.error('[VideoCanvas] Could not get uniform locations');
    gl.deleteProgram(program);
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
  if (!vao) {
    gl.deleteProgram(program);
    return null;
  }
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  if (!vbo) {
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    return null;
  }
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
  const texture = createVideoTexture(gl);
  if (!texture) {
    gl.deleteBuffer(vbo);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    return null;
  }

  console.log('[VideoCanvas] WebGL2 initialized');

  return { gl, program, texture, vao, vbo, flipYLocation, flipXLocation };
}

export function VideoCanvas({ visible, className, flipY = false, flipX = false }: VideoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glStateRef = useRef<WebGLState | null>(null);
  const drawErrorCount = useRef(0);
  const contextLostRef = useRef(false);
  const cadenceRef = useRef<FrameCadenceStats>(createFrameCadenceStats());
  const activeRef = useRef(visible);
  const hasVideoFrameRef = useRef(false);
  const initializationFailureRef = useRef<string | null>(null);
  const pipelineFailureReportedRef = useRef(false);
  const restorationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Linux frame pacing state (unused elsewhere).
  const pacedRef = useRef(!!window.platform?.isLinux);
  const pacerRef = useRef(new FramePacer<PacedSlot>({ maxDepth: PACED_MAX_DEPTH }));
  const allSlotsRef = useRef<PacedSlot[]>([]);
  const freeSlotsRef = useRef<PacedSlot[]>([]);
  const shownSlotRef = useRef<PacedSlot | null>(null);
  const presentStatsRef = useRef<PresentStats>(createPresentStats());
  const reportedDelayRef = useRef(0);
  const flipRef = useRef({ flipY, flipX });
  flipRef.current = { flipY, flipX };
  // The 2s cadence line is only built and sent while debug logging is on.
  const debugEnabledRef = useRef(false);

  // Return every paced slot to the free list (stream change).
  const recyclePacedSlots = useCallback(() => {
    for (const slot of pacerRef.current.reset()) freeSlotsRef.current.push(slot);
    if (shownSlotRef.current) freeSlotsRef.current.push(shownSlotRef.current);
    shownSlotRef.current = null;
    presentStatsRef.current = createPresentStats();
    reportedDelayRef.current = 0;
  }, []);

  // Forget every paced slot (context lost or destroyed; textures die with it).
  const forgetPacedSlots = useCallback(() => {
    pacerRef.current.reset();
    allSlotsRef.current = [];
    freeSlotsRef.current = [];
    shownSlotRef.current = null;
    presentStatsRef.current = createPresentStats();
  }, []);

  const cancelRestorationTimer = useCallback(() => {
    if (restorationTimerRef.current !== null) clearTimeout(restorationTimerRef.current);
    restorationTimerRef.current = null;
  }, []);

  const reportPipelineFailure = useCallback((message: string) => {
    if (pipelineFailureReportedRef.current) return;
    pipelineFailureReportedRef.current = true;
    window.sharedTexture?.reportPipelineFailure(message);
  }, []);

  const checkRendererHealth = useCallback(() => {
    if (!activeRef.current || !hasVideoFrameRef.current || pipelineFailureReportedRef.current) return;
    if (initializationFailureRef.current) {
      reportPipelineFailure(initializationFailureRef.current);
      return;
    }
    if (contextLostRef.current && restorationTimerRef.current === null) {
      restorationTimerRef.current = setTimeout(() => {
        restorationTimerRef.current = null;
        if (activeRef.current && hasVideoFrameRef.current && contextLostRef.current) {
          reportPipelineFailure('WebGL context did not recover within 6 seconds');
        }
      }, 6000);
    }
  }, [reportPipelineFailure]);

  useEffect(() => {
    activeRef.current = visible;
    if (!visible) cancelRestorationTimer();
    else checkRendererHealth();
  }, [visible, cancelRestorationTimer, checkRendererHealth]);

  // Handle frame - render immediately
  const handleFrame = useCallback((videoFrame: VideoFrame, index: number) => {
    const canvas = canvasRef.current;
    const glState = glStateRef.current;

    if (!canvas || videoFrame.codedWidth <= 0 || videoFrame.codedHeight <= 0) {
      videoFrame.close();
      return;
    }
    hasVideoFrameRef.current = true;
    if (!glState || contextLostRef.current) {
      try { checkRendererHealth(); } finally { videoFrame.close(); }
      return;
    }

    const { gl, texture } = glState;
    const width = videoFrame.codedWidth;
    const height = videoFrame.codedHeight;
    const frameAt = performance.now();
    const cadence = cadenceRef.current;
    if (cadence.startedAt === 0) cadence.startedAt = frameAt;
    if (cadence.lastFrameAt > 0) cadence.intervals.push(frameAt - cadence.lastFrameAt);
    if (cadence.lastFrameIndex >= 0) {
      if (index <= cadence.lastFrameIndex) cadence.outOfOrder++;
      else cadence.indexGaps += Math.max(0, index - cadence.lastFrameIndex - 1);
    }
    cadence.lastFrameAt = frameAt;
    cadence.lastFrameIndex = index;
    cadence.frames++;

    // Draw (or, on Linux, copy into a paced slot). The frame is closed in
    // finally so a throw anywhere here cannot leak a VideoFrame (and, on
    // Linux, the DMA-BUF slot behind it).
    const drawStartedAt = performance.now();
    let drawError: string | null = null;
    let uploadSlot: PacedSlot | null = null;
    let queued = false;
    try {
      if (pacedRef.current) {
        uploadSlot = freeSlotsRef.current.pop() ?? null;
        if (!uploadSlot && allSlotsRef.current.length < PACED_SLOT_COUNT) {
          const slotTexture = createVideoTexture(gl);
          if (!slotTexture) throw new Error('could not create a video texture');
          uploadSlot = { texture: slotTexture, width: 0, height: 0, arrivedAt: 0 };
          allSlotsRef.current.push(uploadSlot);
        }
        // Every slot busy (the display loop is not running): reuse the oldest queued frame.
        if (!uploadSlot) uploadSlot = pacerRef.current.dropOldest() ?? null;
        if (!uploadSlot) throw new Error('no video texture available');
        gl.bindTexture(gl.TEXTURE_2D, uploadSlot.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoFrame);
        uploadSlot.width = width;
        uploadSlot.height = height;
        uploadSlot.arrivedAt = frameAt;
        for (const evicted of pacerRef.current.push(uploadSlot, frameAt)) freeSlotsRef.current.push(evicted);
        queued = true;
      } else {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoFrame);
        drawTextureQuad(glState, canvas, texture, width, height, flipY, flipX);
      }
    } catch (e) {
      drawErrorCount.current++;
      const count = drawErrorCount.current;
      drawError = gl.isContextLost() ? 'WebGL context lost' : `Draw error: ${e}`;
      if (count === 1 || count === 10 || count === 100) {
        console.error(`[VideoCanvas] ${drawError} (${count} total)`);
        window.debug?.logFromRenderer(`[VideoCanvas] ${drawError} (${count} total)`).catch(() => {});
      }
    } finally {
      videoFrame.close();
      if (uploadSlot && !queued) freeSlotsRef.current.push(uploadSlot);
    }
    // Preload also tracks import failures, so it must see successful draws.
    window.sharedTexture?.reportDrawResult(drawError === null, drawError ?? undefined);
    if (drawError === null) drawErrorCount.current = 0;
    const drawMs = performance.now() - drawStartedAt;
    cadence.drawMs += drawMs;
    cadence.maxDrawMs = Math.max(cadence.maxDrawMs, drawMs);

    if (frameAt - cadence.startedAt >= 2000) {
      const intervals = [...cadence.intervals].sort((left, right) => left - right);
      const percentile = (value: number) => intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * value))] ?? 0;
      const avgDraw = cadence.frames > 0 ? cadence.drawMs / cadence.frames : 0;
      let paced = '';
      if (pacedRef.current) {
        const present = presentStatsRef.current;
        const shown = [...present.intervals].sort((left, right) => left - right);
        const shownAt = (value: number) => shown[Math.min(shown.length - 1, Math.floor(shown.length * value))] ?? 0;
        const delay = present.delayCount > 0 ? present.delaySum / present.delayCount : 0;
        const pacer = pacerRef.current;
        paced = ` | shown:${present.delayCount} interval p50/p95/max:${shownAt(0.5).toFixed(1)}/${shownAt(0.95).toFixed(1)}/${shownAt(1).toFixed(1)}ms ` +
          `delay:${delay.toFixed(0)}ms depth:${pacer.depth} underruns:${pacer.underruns} skipped:${pacer.skipped}`;
        pacer.underruns = 0;
        pacer.skipped = 0;
        presentStatsRef.current = { ...createPresentStats(), lastAt: present.lastAt };
        // Tell main how far behind arrival the picture is, so mpv can delay the
        // audio by the same amount. Only when it moved noticeably.
        if (present.delayCount >= 10 && Math.abs(delay - reportedDelayRef.current) > 15) {
          reportedDelayRef.current = delay;
          window.sharedTexture?.reportPresentationDelay?.(delay);
        }
      }
      if (debugEnabledRef.current) {
        // Chromium-only heap counters: a falling "used" between lines marks a major GC.
        const heap = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
        const heapText = heap ? ` heap:${(heap.usedJSHeapSize / 1048576).toFixed(1)}/${(heap.totalJSHeapSize / 1048576).toFixed(1)}MB` : '';
        window.debug?.logFromRenderer(
          `[VideoCanvas] cadence frames:${cadence.frames} gaps:${cadence.indexGaps} reverse:${cadence.outOfOrder} ` +
          `interval p50/p95/max:${percentile(0.5).toFixed(1)}/${percentile(0.95).toFixed(1)}/${percentile(1).toFixed(1)}ms ` +
          `draw avg/max:${avgDraw.toFixed(1)}/${cadence.maxDrawMs.toFixed(1)}ms${paced}${heapText}`
        ).catch(() => {});
      }
      cadenceRef.current = {
        ...createFrameCadenceStats(),
        startedAt: frameAt,
        lastFrameAt: frameAt,
        lastFrameIndex: index,
      };
    }
  }, [flipY, flipX, checkRendererHealth]);

  // Follow the debug logging setting. On Linux, while it is on, also log every
  // renderer main-thread task over 50ms with its wall-clock time, so stalls can
  // be told apart from GPU-process or main-process ones.
  useEffect(() => {
    const debug = window.debug;
    if (!debug?.isEnabled) return;
    let observer: PerformanceObserver | null = null;
    const apply = (enabled: boolean) => {
      debugEnabledRef.current = enabled;
      if (enabled && pacedRef.current && !observer && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const at = new Date(performance.timeOrigin + entry.startTime).toISOString();
            debug.logFromRenderer(`[VideoCanvas] longtask ${entry.duration.toFixed(0)}ms at ${at}`).catch(() => {});
          }
        });
        observer.observe({ type: 'longtask' });
      } else if (!enabled && observer) {
        observer.disconnect();
        observer = null;
      }
    };
    let disposed = false;
    debug.isEnabled().then((enabled) => { if (!disposed) apply(enabled); }).catch(() => {});
    const unsubscribe = debug.onEnabledChanged?.((enabled) => apply(enabled));
    return () => {
      disposed = true;
      unsubscribe?.();
      observer?.disconnect();
    };
  }, []);

  // Linux: show queued frames on a steady clock from the display refresh loop.
  useEffect(() => {
    if (!pacedRef.current) return;
    let raf = 0;
    let lastTick = 0;
    let refreshMs = 1000 / 60;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (lastTick > 0) {
        const delta = now - lastTick;
        if (delta > 4 && delta < 50) refreshMs += (delta - refreshMs) * 0.05;
      }
      lastTick = now;
      const slot = pacerRef.current.tick(now, refreshMs);
      if (!slot) return;
      const canvas = canvasRef.current;
      const glState = glStateRef.current;
      if (!canvas || !glState || contextLostRef.current) {
        freeSlotsRef.current.push(slot);
        return;
      }
      try {
        drawTextureQuad(glState, canvas, slot.texture, slot.width, slot.height, flipRef.current.flipY, flipRef.current.flipX);
      } catch (e) {
        console.error('[VideoCanvas] Paced draw failed:', e);
      }
      if (shownSlotRef.current) freeSlotsRef.current.push(shownSlotRef.current);
      shownSlotRef.current = slot;
      const present = presentStatsRef.current;
      if (present.lastAt > 0) present.intervals.push(now - present.lastAt);
      present.lastAt = now;
      present.delaySum += now - slot.arrivedAt;
      present.delayCount++;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);


  // Initialize WebGL on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    const initialize = () => {
      if (!canvas) return;
      try {
        glStateRef.current = initWebGL(canvas);
        initializationFailureRef.current = glStateRef.current ? null : 'WebGL2 initialization failed';
      } catch (error) {
        glStateRef.current = null;
        initializationFailureRef.current = `WebGL2 initialization failed: ${String(error)}`;
      }
      checkRendererHealth();
    };
    if (canvas && !glStateRef.current) {
      initialize();
    }

    // Handle GPU reset / sleep-wake context loss
    const handleContextLost = (e: Event) => {
      e.preventDefault(); // Required to allow context restoration
      console.warn('[VideoCanvas] WebGL context lost');
      window.debug?.logFromRenderer('[VideoCanvas] WebGL context lost');
      glStateRef.current = null;
      forgetPacedSlots();
      contextLostRef.current = true;
      checkRendererHealth();
    };

    const handleContextRestored = () => {
      console.log('[VideoCanvas] WebGL context restored, reinitializing');
      window.debug?.logFromRenderer('[VideoCanvas] WebGL context restored');
      cancelRestorationTimer();
      contextLostRef.current = false;
      initialize();
    };

    canvas?.addEventListener('webglcontextlost', handleContextLost);
    canvas?.addEventListener('webglcontextrestored', handleContextRestored);

    return () => {
      cancelRestorationTimer();
      canvas?.removeEventListener('webglcontextlost', handleContextLost);
      canvas?.removeEventListener('webglcontextrestored', handleContextRestored);
      // Cleanup WebGL resources
      const glState = glStateRef.current;
      if (glState) {
        const { gl, program, texture, vao, vbo } = glState;
        for (const slot of allSlotsRef.current) gl.deleteTexture(slot.texture);
        forgetPacedSlots();
        gl.deleteTexture(texture);
        gl.deleteVertexArray(vao);
        gl.deleteBuffer(vbo);
        gl.deleteProgram(program);
        glStateRef.current = null;
      }
    };
  }, [cancelRestorationTimer, checkRendererHealth, forgetPacedSlots]);

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

  // Clear canvas to black on content switch (prevents stale freeze-frame)
  useEffect(() => {
    if (!window.sharedTexture?.isAvailable) return;

    window.sharedTexture.onClear(() => {
      hasVideoFrameRef.current = false;
      cancelRestorationTimer();
      recyclePacedSlots();
      const glState = glStateRef.current;
      if (glState && !contextLostRef.current) {
        const { gl } = glState;
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    });

    return () => {
      window.sharedTexture?.removeClearListener();
    };
  }, [cancelRestorationTimer, recyclePacedSlots]);

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
