/**
 * SharedTextureVideo.tsx
 *
 * WebGPU-based video display component for Electron's sharedTexture API.
 * Receives frames from mpv via GPU texture sharing for zero-copy rendering.
 */

import { useEffect, useRef, useCallback, useState } from 'react';

interface SharedTextureVideoProps {
  /** Called when WebGPU is ready */
  onReady?: () => void;
  /** Called on WebGPU initialization error */
  onError?: (error: Error) => void;
  /** CSS class name */
  className?: string;
  /** Whether this component should be active */
  active?: boolean;
}

// Extend Window type for Electron's sharedTexture API
declare global {
  interface Window {
    electron?: {
      sharedTexture?: {
        setSharedTextureReceiver: (
          callback: (
            data: { importedSharedTexture: SharedTextureImported },
            codedSize: { width: number; height: number }
          ) => Promise<void> | void
        ) => void;
      };
    };
  }
}

interface SharedTextureImported {
  getVideoFrame(): VideoFrame;
  release(): void;
}

interface WebGPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  pipeline: GPURenderPipeline;
  sampler: GPUSampler;
  bindGroupLayout: GPUBindGroupLayout;
}

export function SharedTextureVideo({
  onReady,
  onError,
  className,
  active = true,
}: SharedTextureVideoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<WebGPUContext | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize WebGPU
  const initWebGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.warn('[SharedTextureVideo] Canvas not available');
      return;
    }

    try {
      // Check WebGPU support
      if (!navigator.gpu) {
        throw new Error('WebGPU not supported in this browser');
      }

      // Get adapter
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });
      if (!adapter) {
        throw new Error('Failed to get WebGPU adapter');
      }

      // Get device
      const device = await adapter.requestDevice();

      // Get canvas context
      const context = canvas.getContext('webgpu');
      if (!context) {
        throw new Error('Failed to get WebGPU context from canvas');
      }

      // Configure context
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({
        device,
        format,
        alphaMode: 'opaque',
      });

      // Create shader module for rendering external textures (VideoFrame)
      const shaderModule = device.createShaderModule({
        label: 'SharedTexture Shader',
        code: `
          @group(0) @binding(0) var mySampler: sampler;
          @group(0) @binding(1) var myTexture: texture_external;

          struct VertexOutput {
            @builtin(position) position: vec4f,
            @location(0) texCoord: vec2f,
          }

          @vertex
          fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
            // Fullscreen quad positions
            var positions = array<vec2f, 6>(
              vec2f(-1.0, -1.0),
              vec2f( 1.0, -1.0),
              vec2f(-1.0,  1.0),
              vec2f(-1.0,  1.0),
              vec2f( 1.0, -1.0),
              vec2f( 1.0,  1.0),
            );

            // Texture coordinates (flip Y for correct orientation)
            var texCoords = array<vec2f, 6>(
              vec2f(0.0, 1.0),
              vec2f(1.0, 1.0),
              vec2f(0.0, 0.0),
              vec2f(0.0, 0.0),
              vec2f(1.0, 1.0),
              vec2f(1.0, 0.0),
            );

            var output: VertexOutput;
            output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
            output.texCoord = texCoords[vertexIndex];
            return output;
          }

          @fragment
          fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
            return textureSampleBaseClampToEdge(myTexture, mySampler, texCoord);
          }
        `,
      });

      // Create bind group layout for external texture
      const bindGroupLayout = device.createBindGroupLayout({
        label: 'SharedTexture BindGroupLayout',
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: 'filtering' },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            externalTexture: {},
          },
        ],
      });

      // Create pipeline layout
      const pipelineLayout = device.createPipelineLayout({
        label: 'SharedTexture PipelineLayout',
        bindGroupLayouts: [bindGroupLayout],
      });

      // Create render pipeline
      const pipeline = device.createRenderPipeline({
        label: 'SharedTexture Pipeline',
        layout: pipelineLayout,
        vertex: {
          module: shaderModule,
          entryPoint: 'vertexMain',
        },
        fragment: {
          module: shaderModule,
          entryPoint: 'fragmentMain',
          targets: [{ format }],
        },
        primitive: {
          topology: 'triangle-list',
        },
      });

      // Create sampler
      const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });

      contextRef.current = { device, context, pipeline, sampler, bindGroupLayout };
      setReady(true);
      setError(null);
      onReady?.();

      console.log('[SharedTextureVideo] WebGPU initialized successfully');
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      console.error('[SharedTextureVideo] WebGPU init failed:', errorObj);
      setError(errorObj.message);
      onError?.(errorObj);
    }
  }, [onReady, onError]);

  // Render a video frame to the canvas
  const renderFrame = useCallback((videoFrame: VideoFrame) => {
    const ctx = contextRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    const { device, context, pipeline, sampler, bindGroupLayout } = ctx;

    try {
      // Import VideoFrame as external texture
      const externalTexture = device.importExternalTexture({
        source: videoFrame,
      });

      // Create bind group for this frame
      const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: externalTexture },
        ],
      });

      // Create command encoder
      const commandEncoder = device.createCommandEncoder();

      // Get current texture view
      const textureView = context.getCurrentTexture().createView();

      // Begin render pass
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });

      // Draw fullscreen quad
      renderPass.setPipeline(pipeline);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(6);
      renderPass.end();

      // Submit commands
      device.queue.submit([commandEncoder.finish()]);
    } catch (err) {
      // Don't spam console on every frame error
      if (Math.random() < 0.01) {
        console.error('[SharedTextureVideo] Render frame error:', err);
      }
    }
  }, []);

  // Set up shared texture receiver
  useEffect(() => {
    if (!active) return;

    const electronSharedTexture = window.electron?.sharedTexture;
    if (!electronSharedTexture) {
      console.warn('[SharedTextureVideo] sharedTexture API not available');
      setError('sharedTexture API not available - using fallback mode');
      return;
    }

    // Initialize WebGPU first
    initWebGPU();

    // Set up receiver callback
    electronSharedTexture.setSharedTextureReceiver(
      async (data, codedSize) => {
        const { importedSharedTexture } = data;

        try {
          // Update canvas size if needed
          const canvas = canvasRef.current;
          if (canvas) {
            if (canvas.width !== codedSize.width || canvas.height !== codedSize.height) {
              canvas.width = codedSize.width;
              canvas.height = codedSize.height;
              // Reconfigure context after resize
              const ctx = contextRef.current;
              if (ctx) {
                ctx.context.configure({
                  device: ctx.device,
                  format: navigator.gpu.getPreferredCanvasFormat(),
                  alphaMode: 'opaque',
                });
              }
            }
          }

          // Get VideoFrame and render
          const videoFrame = importedSharedTexture.getVideoFrame();
          renderFrame(videoFrame);

          // Close the video frame when done
          videoFrame.close();
        } finally {
          // Always release the shared texture
          importedSharedTexture.release();
        }
      }
    );

    return () => {
      // Cleanup - reset receiver
      // Note: Electron may not have a way to clear the receiver
    };
  }, [active, initWebGPU, renderFrame]);

  // Handle canvas resize via ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          // Canvas size is managed by sharedTexture receiver based on video size
          // This observer is just for layout changes
        }
      }
    });

    resizeObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  if (!active) {
    return null;
  }

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          backgroundColor: '#000',
        }}
      />
      {error && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#f00',
            backgroundColor: 'rgba(0,0,0,0.8)',
            padding: '1rem',
            borderRadius: '4px',
            textAlign: 'center',
          }}
        >
          <p>WebGPU Error:</p>
          <p style={{ fontSize: '0.875rem', opacity: 0.8 }}>{error}</p>
        </div>
      )}
      {!ready && !error && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#fff',
            opacity: 0.5,
          }}
        >
          Initializing WebGPU...
        </div>
      )}
    </div>
  );
}

export default SharedTextureVideo;
