import { useState, useEffect, useCallback, useRef } from 'react';
import { Logo } from '../Logo';
import { SbtlMark } from '../SbtlMark';
import { useUIStore, useUpdateSettings, useUpdaterState, useSetUpdaterState } from '../../stores/uiStore';
import { debugLog } from '../../utils/debugLog';
import './AboutTab.css';

interface AboutTabProps {
  autoUpdateEnabled: boolean;
  onAutoUpdateChange: (enabled: boolean) => void;
}

const CHECK_TIMEOUT_MS = 30_000;

export function AboutTab({ autoUpdateEnabled, onAutoUpdateChange }: AboutTabProps) {
  const updateSettings = useUpdateSettings();
  const updaterState = useUpdaterState();
  const setUpdaterState = useSetUpdaterState();
  const [version, setVersion] = useState<string>('');
  const checkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noAutoUpdate = !(window.platform?.supportsAutoUpdate ?? true);

  useEffect(() => {
    window.platform?.getVersion().then(setVersion).catch((err) => {
      console.error('Failed to get app version:', err);
      setVersion('unknown');
    });
  }, []);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (checkTimeoutRef.current !== null) clearTimeout(checkTimeoutRef.current);
    };
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    if (!window.updater) {
      setUpdaterState({ phase: 'error', message: 'Auto-updater not available in dev mode' });
      return;
    }
    setUpdaterState({ phase: 'checking' });

    // Timeout: recover from stuck checking state
    checkTimeoutRef.current = setTimeout(() => {
      const { updaterState } = useUIStore.getState();
      if (updaterState.phase === 'checking') {
        useUIStore.getState().setUpdaterState({ phase: 'error', message: 'Update check timed out. Try again.' });
      }
    }, CHECK_TIMEOUT_MS);

    try {
      const result = await window.updater.checkForUpdates();
      if (checkTimeoutRef.current !== null) clearTimeout(checkTimeoutRef.current);
      if (result.error) {
        if (result.error === 'dev' || result.error === 'portable' || result.error === 'no-auto-update') {
          setUpdaterState({ phase: 'error', message: 'Auto-updates are not available for this build' });
        } else if (result.error.includes('404') || result.error.includes('latest.yml')) {
          setUpdaterState({ phase: 'error', message: 'Unable to check for updates. Please check GitHub releases.' });
        } else {
          setUpdaterState({ phase: 'error', message: result.error.split('\n')[0] });
        }
      } else if (result.data && result.data.version !== version) {
        // autoUpdater.autoDownload is enabled in main, so download starts
        // immediately — updater events will update progress and completion
        setUpdaterState({ phase: 'downloading', percent: 0, version: result.data.version });
      } else {
        setUpdaterState({ phase: 'up-to-date' });
      }
    } catch (err) {
      if (checkTimeoutRef.current !== null) clearTimeout(checkTimeoutRef.current);
      debugLog(`Check failed: ${err instanceof Error ? err.message : String(err)}`);
      setUpdaterState({ phase: 'error', message: 'Failed to check for updates' });
    }
  }, [version, setUpdaterState]);

  async function handleInstall() {
    if (!window.updater) return;
    try {
      const result = await window.updater.installUpdate();
      if (result?.error) {
        debugLog(`Install failed: ${result.error}`);
        setUpdaterState({ phase: 'error', message: result.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Install failed';
      debugLog(`Install error: ${msg}`);
      setUpdaterState({ phase: 'error', message: 'Failed to install update. Please restart manually.' });
    }
  }

  async function handleAutoUpdateChange(enabled: boolean) {
    onAutoUpdateChange(enabled);
    updateSettings({ autoUpdateEnabled: enabled });
    if (!window.storage) return;
    await window.storage.updateSettings({ autoUpdateEnabled: enabled });
  }

  function renderUpdateButton() {
    switch (updaterState.phase) {
      case 'checking':
        return (
          <button className="save-btn about-tab__update-btn" disabled>
            Checking...
          </button>
        );
      case 'downloading':
        return (
          <button className="save-btn about-tab__update-btn" disabled>
            Downloading v{updaterState.version}... {updaterState.percent}%
          </button>
        );
      case 'ready':
        return (
          <button className="save-btn about-tab__update-btn about-tab__update-btn--restart" onClick={handleInstall}>
            Restart to Update
          </button>
        );
      case 'idle':
      case 'up-to-date':
      case 'error':
        return (
          <button className="save-btn about-tab__update-btn" onClick={handleCheckForUpdates}>
            Check for Updates
          </button>
        );
    }
  }

  function renderStatusText() {
    switch (updaterState.phase) {
      case 'up-to-date':
        return 'You are on the latest version';
      case 'ready':
        return `v${updaterState.version} downloaded — restart to install`;
      case 'error':
        return updaterState.message;
      case 'idle':
      case 'checking':
      case 'downloading':
        return null;
    }
  }

  const statusText = renderStatusText();

  return (
    <div className="settings-tab-content about-tab">
      <div className="about-tab__center">
        <div className="about-tab__logo-row">
          <Logo width={48} height={48} />
          <span className="about-tab__title">
            sbtlTV <span className="about-tab__version">v{version || '...'}</span>
          </span>
        </div>

        <div className="about-tab__update-section">
          {noAutoUpdate ? (
            <>
              <a
                href="https://github.com/thesubtleties/sbtlTV/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="save-btn about-tab__update-btn"
                style={{ textDecoration: 'none', textAlign: 'center' }}
              >
                View Releases on GitHub
              </a>
              <p className="form-hint about-tab__status-text">
                Auto-updates are not available for this build.
              </p>
            </>
          ) : (
            <>
              {renderUpdateButton()}
              <div className="about-tab__status">
                {statusText && (
                  <p className="form-hint about-tab__status-text">
                    {statusText}
                  </p>
                )}
              </div>
              <label className="genre-checkbox about-tab__auto-update">
                <input
                  type="checkbox"
                  checked={autoUpdateEnabled}
                  onChange={(e) => handleAutoUpdateChange(e.target.checked)}
                />
                <span className="genre-name">Check for updates automatically</span>
              </label>
            </>
          )}
        </div>
      </div>

      <div className="about-tab__footer">
        <div className="about-tab__links">
          <a
            href="https://github.com/thesubtleties/sbtlTV"
            target="_blank"
            rel="noopener noreferrer"
            title="GitHub"
            className="about-tab__link"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          </a>
          <a
            href="https://sbtl.dev?utm_source=sbtltv&utm_medium=about"
            target="_blank"
            rel="noopener noreferrer"
            title="sbtl.dev"
            className="about-tab__link"
          >
            <SbtlMark width="28" height="22" />
          </a>
        </div>

        <p className="settings-disclaimer about-tab__license">
          sbtlTV is free and open source software, licensed under the{' '}
          <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">
            GNU Affero General Public License v3
          </a>
          .
        </p>
      </div>
    </div>
  );
}
