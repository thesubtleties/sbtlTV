import { useEffect, useState } from 'react';
import { useUpdateSettings } from '../../stores/uiStore';

type LinuxPlayerMode = 'native' | 'compatibility';

interface SecurityTabProps {
  allowLanSources: boolean;
  onAllowLanSourcesChange: (enabled: boolean) => void;
  linuxPlayerMode: LinuxPlayerMode;
  onLinuxPlayerModeChange: (mode: LinuxPlayerMode) => void;
}

export function SecurityTab({
  allowLanSources,
  onAllowLanSourcesChange,
  linuxPlayerMode,
  onLinuxPlayerModeChange,
}: SecurityTabProps) {
  const updateSettings = useUpdateSettings();
  // The player mode is read once at launch. Ask main which player this
  // process started with and offer a restart only while the saved value differs.
  const [launchedPlayerMode, setLaunchedPlayerMode] = useState<LinuxPlayerMode | null>(null);
  useEffect(() => {
    if (!window.platform?.isLinux || !window.mpv) return;
    let cancelled = false;
    window.mpv.getMode().then((info) => {
      if (!cancelled) setLaunchedPlayerMode(info.launchPlayerMode ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const playerModeChanged = launchedPlayerMode !== null && linuxPlayerMode !== launchedPlayerMode;

  async function handleAllowLanChange(enabled: boolean) {
    onAllowLanSourcesChange(enabled);
    updateSettings({ allowLanSources: enabled });
    if (!window.storage) return;
    await window.storage.updateSettings({ allowLanSources: enabled });
  }

  async function handlePlayerModeChange(mode: LinuxPlayerMode) {
    onLinuxPlayerModeChange(mode);
    updateSettings({ linuxPlayerMode: mode });
    if (!window.storage) return;
    await window.storage.updateSettings({ linuxPlayerMode: mode });
  }

  return (
    <div className="settings-tab-content">
      {window.platform?.isLinux && (
        <div className="settings-section">
          <div className="section-header">
            <h3>Video Player (Linux)</h3>
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
                ? 'Takes effect after restarting sbtlTV.'
                : 'Changing this takes effect after restarting sbtlTV.'}
            </p>
            {playerModeChanged && (
              <button
                type="button"
                className="sync-button"
                style={{ marginTop: '0.5rem', padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                onClick={() => window.electronWindow?.relaunch()}
              >
                Restart sbtlTV
              </button>
            )}
          </div>
        </div>
      )}

      <div className="settings-section">
        <div className="section-header">
          <h3>Network Security</h3>
        </div>

        <p className="section-description">
          By default, sbtlTV blocks requests to local network addresses to prevent
          malicious playlists from probing your internal network (SSRF protection).
        </p>

        <div className="tmdb-form" style={{ marginTop: '1rem' }}>
          <label className="genre-checkbox" style={{ maxWidth: '320px' }}>
            <input
              type="checkbox"
              checked={allowLanSources}
              onChange={(e) => handleAllowLanChange(e.target.checked)}
            />
            <span className="genre-name">Allow LAN sources</span>
          </label>
          <p className="form-hint" style={{ marginTop: '0.5rem' }}>
            Enable this if your IPTV provider runs on your local network
            (e.g., Plex, Jellyfin, or a NAS). Only enable if you trust your playlist sources.
          </p>
        </div>
      </div>

      <p className="settings-disclaimer">
        Blocked addresses: localhost, 127.x.x.x, 10.x.x.x, 172.16-31.x.x, 192.168.x.x,
        and cloud metadata endpoints (169.254.x.x).
      </p>
    </div>
  );
}
