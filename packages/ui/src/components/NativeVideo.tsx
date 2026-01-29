import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';

interface NativeVideoProps {
  url: string | null;
  playing: boolean;
  volume: number;
  muted: boolean;
  onStatusChange?: (status: {
    playing: boolean;
    volume: number;
    muted: boolean;
    position: number;
    duration: number;
  }) => void;
  onError?: (error: string) => void;
  onReady?: () => void;
}

/**
 * Native HTML5 video player.
 * Used on macOS and Linux for native video rendering.
 *
 * On Linux, WebKitGTK uses GStreamer as the media backend.
 * HLS streams require gst-plugins-bad to be installed.
 */
export const NativeVideo = forwardRef<HTMLVideoElement, NativeVideoProps>(function NativeVideo({
  url,
  playing,
  volume,
  muted,
  onStatusChange,
  onError,
  onReady,
}, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Expose the video element via ref
  useImperativeHandle(ref, () => videoRef.current!, []);

  // Load video source
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (url) {
      console.log('[NativeVideo] Loading URL:', url);
      video.src = url;
      video.load();

      // Wait for video to be ready before signaling
      const handleCanPlay = () => {
        console.log('[NativeVideo] Can play');
        onReady?.();
        video.removeEventListener('canplay', handleCanPlay);
      };
      video.addEventListener('canplay', handleCanPlay);

      return () => {
        video.removeEventListener('canplay', handleCanPlay);
      };
    } else {
      video.removeAttribute('src');
      video.load();
    }
  }, [url, onReady]);

  // Control playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    if (playing && video.paused) {
      console.log('[NativeVideo] Attempting play, readyState:', video.readyState);
      // Wait for enough data before playing
      if (video.readyState >= 2) {
        video.play().catch((e) => {
          console.error('[NativeVideo] Play failed:', e);
        });
      } else {
        const handleCanPlay = () => {
          console.log('[NativeVideo] Now can play, starting...');
          video.play().catch((e) => {
            console.error('[NativeVideo] Play failed after canplay:', e);
          });
          video.removeEventListener('canplay', handleCanPlay);
        };
        video.addEventListener('canplay', handleCanPlay);
        return () => video.removeEventListener('canplay', handleCanPlay);
      }
    } else if (!playing && !video.paused) {
      video.pause();
    }
  }, [playing, url]);

  // Control volume
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = volume / 100;
    video.muted = muted;
  }, [volume, muted]);

  // Status updates
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !onStatusChange) return;

    onStatusChange({
      playing: !video.paused,
      volume: video.volume * 100,
      muted: video.muted,
      position: video.currentTime,
      duration: video.duration || 0,
    });
  }, [onStatusChange]);

  const handlePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !onStatusChange) return;

    onStatusChange({
      playing: true,
      volume: video.volume * 100,
      muted: video.muted,
      position: video.currentTime,
      duration: video.duration || 0,
    });
  }, [onStatusChange]);

  const handlePause = useCallback(() => {
    const video = videoRef.current;
    if (!video || !onStatusChange) return;

    onStatusChange({
      playing: false,
      volume: video.volume * 100,
      muted: video.muted,
      position: video.currentTime,
      duration: video.duration || 0,
    });
  }, [onStatusChange]);

  const handleError = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const error = video.error;
    let message = 'Unknown video error';

    console.error('[NativeVideo] Error event fired');
    console.error('[NativeVideo] Video src:', video.src);
    console.error('[NativeVideo] Error object:', error);
    console.error('[NativeVideo] Network state:', video.networkState);
    console.error('[NativeVideo] Ready state:', video.readyState);

    if (error) {
      switch (error.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          message = 'Video playback aborted';
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          message = 'Network error while loading video';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          message = 'Video decode error - check GStreamer plugins';
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          message = 'Video format not supported - install gst-plugins-bad for HLS';
          break;
      }
    }

    console.error('[NativeVideo] Error:', message);
    onError?.(message);
  }, [onError]);

  return (
    <video
      ref={videoRef}
      className="native-video"
      autoPlay={playing}
      playsInline
      onLoadStart={() => console.log('[NativeVideo] Load started')}
      onWaiting={() => console.log('[NativeVideo] Waiting for data')}
      onStalled={() => console.log('[NativeVideo] Stalled')}
      onSuspend={() => console.log('[NativeVideo] Suspended')}
      onTimeUpdate={handleTimeUpdate}
      onPlay={handlePlay}
      onPause={handlePause}
      onError={handleError}
      onLoadedMetadata={() => {
        console.log('[NativeVideo] Metadata loaded');
        const video = videoRef.current;
        if (video && onStatusChange) {
          onStatusChange({
            playing: !video.paused,
            volume: video.volume * 100,
            muted: video.muted,
            position: video.currentTime,
            duration: video.duration || 0,
          });
        }
      }}
    />
  );
});
