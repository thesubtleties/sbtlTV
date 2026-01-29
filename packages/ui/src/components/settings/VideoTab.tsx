import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface VideoTabProps {
  useMpvWindow: boolean;
  onUseMpvWindowChange: (value: boolean) => void;
}

type Platform = 'windows' | 'macos' | 'linux' | 'unknown';

export function VideoTab({ useMpvWindow, onUseMpvWindowChange }: VideoTabProps) {
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [mpvWindowLoading, setMpvWindowLoading] = useState(false);

  // Detect platform
  useEffect(() => {
    const detectPlatform = async () => {
      if (window.__TAURI__) {
        try {
          const info = await invoke<{ is_windows: boolean; is_mac: boolean; is_linux: boolean }>('get_platform');
          if (info.is_windows) setPlatform('windows');
          else if (info.is_mac) setPlatform('macos');
          else if (info.is_linux) setPlatform('linux');
        } catch (e) {
          console.warn('[VideoTab] Platform detection failed:', e);
        }
      } else if (window.platform) {
        if (window.platform.isWindows) setPlatform('windows');
        else if (window.platform.isMac) setPlatform('macos');
        else if (window.platform.isLinux) setPlatform('linux');
      }
    };
    detectPlatform();
  }, []);

  const handleMpvWindowToggle = async () => {
    if (platform !== 'linux') return;

    setMpvWindowLoading(true);
    try {
      if (!useMpvWindow) {
        // Enable external mpv window
        await invoke('mpv_enable_external_window');
        onUseMpvWindowChange(true);
      } else {
        // Disable external mpv window
        await invoke('mpv_disable_external_window');
        onUseMpvWindowChange(false);
      }
    } catch (e) {
      console.error('[VideoTab] Failed to toggle mpv window:', e);
    } finally {
      setMpvWindowLoading(false);
    }
  };

  return (
    <div className="settings-section">
      <h3>Video Playback</h3>

      <div className="settings-info">
        <p>
          <strong>Current platform:</strong>{' '}
          {platform === 'windows' && 'Windows (mpv embedded)'}
          {platform === 'macos' && 'macOS (native video)'}
          {platform === 'linux' && 'Linux (native video by default)'}
          {platform === 'unknown' && 'Detecting...'}
        </p>
      </div>

      {platform === 'windows' && (
        <div className="settings-note">
          <p>
            On Windows, video is rendered directly by mpv embedded in the application window.
            This provides the best performance and codec support.
          </p>
        </div>
      )}

      {platform === 'macos' && (
        <div className="settings-note">
          <p>
            On macOS, video is rendered using the native video player with HLS.js support.
            This provides smooth playback with hardware acceleration.
          </p>
        </div>
      )}

      {platform === 'linux' && (
        <>
          <div className="settings-note">
            <p>
              On Linux, video is rendered using the native video player by default.
              Power users can enable an external mpv window for better codec support.
            </p>
          </div>

          <div className="settings-row">
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={useMpvWindow}
                onChange={handleMpvWindowToggle}
                disabled={mpvWindowLoading}
              />
              <span>Use external mpv window (power user)</span>
            </label>
            {mpvWindowLoading && <span className="loading-indicator">...</span>}
          </div>

          {useMpvWindow && (
            <div className="settings-warning">
              <p>
                External mpv window is enabled. Video will play in a separate window.
                Make sure mpv is installed on your system.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
