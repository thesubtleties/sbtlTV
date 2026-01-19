import { type ChangeEvent, useEffect, useState } from 'react';
import type { StoredChannel } from '../db';
import { useCurrentProgram } from '../hooks/useChannels';
import './NowPlayingBar.css';

interface NowPlayingBarProps {
  visible: boolean;
  channel: StoredChannel | null;
  playing: boolean;
  muted: boolean;
  volume: number;
  mpvReady: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  onToggleMute: () => void;
  onVolumeChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onVolumeDragStart?: () => void;
  onVolumeDragEnd?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function NowPlayingBar({
  visible,
  channel,
  playing,
  muted,
  volume,
  mpvReady,
  onTogglePlay,
  onStop,
  onToggleMute,
  onVolumeChange,
  onVolumeDragStart,
  onVolumeDragEnd,
  onMouseEnter,
  onMouseLeave,
}: NowPlayingBarProps) {
  const canControl = mpvReady && channel !== null;
  const currentProgram = useCurrentProgram(channel?.stream_id ?? null);

  // Progress tracking - updates every second
  const [progress, setProgress] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState('');

  useEffect(() => {
    if (!currentProgram) {
      setProgress(0);
      setTimeRemaining('');
      return;
    }

    const updateProgress = () => {
      const now = new Date().getTime();
      const start = new Date(currentProgram.start).getTime();
      const end = new Date(currentProgram.end).getTime();
      const duration = end - start;
      const elapsed = now - start;

      const pct = Math.min(100, Math.max(0, (elapsed / duration) * 100));
      setProgress(pct);

      // Calculate time remaining
      const remainingMs = Math.max(0, end - now);
      const remainingMins = Math.ceil(remainingMs / 60000);
      if (remainingMins >= 60) {
        const hrs = Math.floor(remainingMins / 60);
        const mins = remainingMins % 60;
        setTimeRemaining(`${hrs}h ${mins}m left`);
      } else {
        setTimeRemaining(`${remainingMins}m left`);
      }
    };

    updateProgress();
    const interval = setInterval(updateProgress, 1000);
    return () => clearInterval(interval);
  }, [currentProgram]);

  return (
    <div
      className={`now-playing-bar ${visible ? 'visible' : 'hidden'}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {channel ? (
        <>
          {/* Row 1: Channel info with description */}
          <div className="npb-row npb-info-row">
            {/* Left: Logo + Channel/Program */}
            <div className="npb-channel-section">
              {channel.stream_icon && (
                <img
                  src={channel.stream_icon}
                  alt=""
                  className="npb-channel-logo"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
              <div className="npb-channel-text">
                <span className="npb-channel-name" title={channel.name}>
                  {channel.name}
                </span>
                {currentProgram ? (
                  <span className="npb-program-title" title={currentProgram.title}>
                    {currentProgram.title}
                  </span>
                ) : (
                  <span className="npb-no-program">No program info</span>
                )}
              </div>
            </div>

            {/* Divider + Description (only if we have a description) */}
            {currentProgram?.description && (
              <>
                <div className="npb-divider" />
                <div className="npb-description-section">
                  <span className="npb-program-desc" title={currentProgram.description}>
                    {currentProgram.description}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Row 2: Progress and controls */}
          <div className="npb-row npb-controls-row">
            {/* Progress section */}
            <div className="npb-progress-section">
              <div className="npb-progress-bar">
                <div
                  className="npb-progress-fill"
                  style={{ width: currentProgram ? `${progress}%` : '0%' }}
                />
              </div>
              <span className="npb-time-remaining">
                {timeRemaining || '--'}
              </span>
            </div>

            {/* Playback controls */}
            <div className="npb-controls">
              <button
                className="npb-btn"
                onClick={onTogglePlay}
                disabled={!canControl}
                title={playing ? 'Pause (Space)' : 'Play (Space)'}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button
                className="npb-btn"
                onClick={onStop}
                disabled={!canControl}
                title="Stop"
              >
                <StopIcon />
              </button>
            </div>

            {/* Volume controls */}
            <div className="npb-volume">
              <button
                className="npb-btn npb-volume-btn"
                onClick={onToggleMute}
                disabled={!mpvReady}
                title={muted ? 'Unmute (M)' : 'Mute (M)'}
              >
                <VolumeIcon muted={muted} volume={volume} />
              </button>
              <input
                type="range"
                className="npb-volume-slider"
                min="0"
                max="100"
                value={volume}
                onChange={onVolumeChange}
                onMouseDown={onVolumeDragStart}
                onMouseUp={onVolumeDragEnd}
                onTouchStart={onVolumeDragStart}
                onTouchEnd={onVolumeDragEnd}
                disabled={!mpvReady}
              />
              <span className="npb-volume-value">{volume}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="npb-empty-state">
          <span>No channel selected</span>
        </div>
      )}
    </div>
  );
}

// Icon components

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}

interface VolumeIconProps {
  muted: boolean;
  volume: number;
}

function VolumeIcon({ muted, volume }: VolumeIconProps) {
  if (muted) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
      </svg>
    );
  }

  if (volume > 50) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
      </svg>
    );
  }

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
    </svg>
  );
}
