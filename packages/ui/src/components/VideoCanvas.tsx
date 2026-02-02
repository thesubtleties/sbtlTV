/**
 * VideoCanvas - Displays VideoFrames from Electron's sharedTexture API
 *
 * Used when native mpv-texture bridge is active. Receives GPU-rendered
 * video frames and displays them via Canvas2D.
 */

import { useEffect, useRef, useCallback } from 'react';

interface VideoCanvasProps {
  /** Whether the canvas should be visible */
  visible: boolean;
  /** Optional CSS class name */
  className?: string;
}

export function VideoCanvas({ visible, className }: VideoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Handle frame rendering
  const handleFrame = useCallback((videoFrame: VideoFrame, _index: number) => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;

    if (!canvas || !ctx) {
      videoFrame.close();
      return;
    }

    // Resize canvas if video dimensions changed
    if (canvas.width !== videoFrame.codedWidth ||
        canvas.height !== videoFrame.codedHeight) {
      canvas.width = videoFrame.codedWidth;
      canvas.height = videoFrame.codedHeight;
      console.log(`[VideoCanvas] Resized to ${videoFrame.codedWidth}x${videoFrame.codedHeight}`);
    }

    // Draw the VideoFrame to canvas
    ctx.drawImage(videoFrame, 0, 0);

    // IMPORTANT: Close the frame when done to prevent memory leaks
    videoFrame.close();
  }, []);

  // Set up canvas context on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      ctxRef.current = canvas.getContext('2d', {
        alpha: false,           // No transparency needed for video
        desynchronized: true,   // Reduces latency by not syncing with compositor
      });
    }
  }, []);

  // Set up sharedTexture receiver
  useEffect(() => {
    if (!window.sharedTexture?.isAvailable) {
      console.log('[VideoCanvas] sharedTexture not available');
      return;
    }

    console.log('[VideoCanvas] Setting up frame receiver');
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
