import { useEffect, useState } from 'react';
import { useUpdateSettings } from '../../stores/uiStore';
import { debugLog } from '../../utils/debugLog';

type LinuxPlayerMode = 'native' | 'compatibility';

interface VideoPlayerTabProps {
  linuxPlayerMode: LinuxPlayerMode;
  onLinuxPlayerModeChange: (mode: LinuxPlayerMode) => void;
  linuxPerformanceMode: boolean;
  onLinuxPerformanceModeChange: (enabled: boolean) => void;
}

/** Linux only: which player to use and the performance-mode fallback. */
export function VideoPlayerTab({
  linuxPlayerMode,
  onLinuxPlayerModeChange,
  linuxPerformanceMode,
  onLinuxPerformanceModeChange,
}: VideoPlayerTabProps) {
  const updateSettings = useUpdateSettings();
  // The player mode is read once at launch. Ask main which player this
  // process started with so the hint can say a restart is still pending.
  const [launchedPlayerMode, setLaunchedPlayerMode] = useState<LinuxPlayerMode | null>(null);
  useEffect(() => {
    if (!window.platform?.isLinux || !window.mpv) return;
    let cancelled = false;
    window.mpv.getMode().then((info) => {
      if (!cancelled) setLaunchedPlayerMode(info.launchPlayerMode ?? null);
    }).catch((err) => debugLog(`getMode failed: ${err instanceof Error ? err.message : err}`, 'settings'));
    return () => { cancelled = true; };
  }, []);
  const playerModeChanged = launchedPlayerMode !== null && linuxPlayerMode !== launchedPlayerMode;

  async function handlePerformanceModeChange(enabled: boolean) {
    onLinuxPerformanceModeChange(enabled);
    updateSettings({ linuxPerformanceMode: enabled });
    if (!window.storage) return;
    await window.storage.updateSettings({ linuxPerformanceMode: enabled });
  }

  async function handlePlayerModeChange(mode: LinuxPlayerMode) {
    onLinuxPlayerModeChange(mode);
    updateSettings({ linuxPlayerMode: mode });
    if (!window.storage) return;
    await window.storage.updateSettings({ linuxPlayerMode: mode });
  }

  return (
    <div className="settings-tab-content settings-tab-scroll">
      <div className="settings-section">
        <div className="section-header">
          <h3>Video Player</h3>
        </div>

        <p className="section-description">
          Video normally plays inside the sbtlTV window. If playback stutters or drops
          frames on your GPU, the compatibility player runs mpv in its own window instead,
          the way sbtlTV worked before 0.10.
        </p>

        <div className="tmdb-form" style={{ marginTop: '1rem' }}>
          <label className="genre-checkbox" style={{ maxWidth: '320px' }}>
            <input
              type="radio"
              name="linux-player-mode"
              checked={linuxPlayerMode === 'native'}
              onChange={() => handlePlayerModeChange('native')}
            />
            <span className="genre-name">In-window player (default)</span>
          </label>
          <label className="genre-checkbox" style={{ maxWidth: '320px' }}>
            <input
              type="radio"
              name="linux-player-mode"
              checked={linuxPlayerMode === 'compatibility'}
              onChange={() => handlePlayerModeChange('compatibility')}
            />
            <span className="genre-name">Compatibility player (separate mpv window)</span>
          </label>
          <p className="form-hint" style={{ marginTop: '0.5rem' }}>
            {playerModeChanged
              ? 'Quit and reopen sbtlTV to switch players.'
              : 'Changing this takes effect the next time sbtlTV starts.'}
          </p>

          <label className="genre-checkbox" style={{ maxWidth: '320px', marginTop: '1rem' }}>
            <input
              type="checkbox"
              checked={linuxPerformanceMode}
              onChange={(e) => handlePerformanceModeChange(e.target.checked)}
            />
            <span className="genre-name">Performance mode</span>
          </label>
          <p className="form-hint" style={{ marginTop: '0.5rem' }}>
            Only if the in-window player drops frames at normal quality. Uses simpler
            video scaling and turns off the blur behind the guide and controls. The blur
            changes right away; the video settings apply after you quit and reopen sbtlTV.
          </p>
        </div>
      </div>
    </div>
  );
}
