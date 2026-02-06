import { useState, useEffect } from 'react';
import { Logo } from '../Logo';
import { SbtlMark } from '../SbtlMark';

export function AboutTab() {
  const [version, setVersion] = useState<string>('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);

  useEffect(() => {
    window.platform?.getVersion().then(setVersion).catch((err) => {
      console.error('Failed to get app version:', err);
      setVersion('unknown');
    });
  }, []);

  async function handleCheckForUpdates() {
    if (!window.updater) {
      setUpdateStatus('Auto-updater not available in dev mode');
      return;
    }
    setCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      const result = await window.updater.checkForUpdates();
      if (result.error) {
        if (result.error === 'dev') {
          setUpdateStatus('Auto-updater not available in dev mode');
        } else if (result.error.includes('404') || result.error.includes('latest.yml')) {
          setUpdateStatus('Unable to check for updates. Please check github.com/thesubtleties/sbtlTV/releases for the latest version.');
        } else {
          setUpdateStatus(`Update check failed: ${result.error.split('\n')[0]}`);
        }
      } else if (result.data) {
        setUpdateStatus(`Update available: v${result.data.version}`);
      } else {
        setUpdateStatus('You are on the latest version');
      }
    } catch (err) {
      console.error('Update check failed:', err);
      setUpdateStatus('Failed to check for updates');
    } finally {
      setCheckingUpdate(false);
    }
  }

  return (
    <div className="settings-tab-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Centered content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem' }}>
        {/* Logo + version */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Logo width={48} height={48} />
          <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '1.1rem', fontWeight: 500 }}>
            sbtlTV <span style={{ color: 'rgba(255, 255, 255, 0.35)', fontWeight: 400 }}>v{version || '...'}</span>
          </span>
        </div>

        {/* Check for updates */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
          <button
            className="save-btn"
            onClick={handleCheckForUpdates}
            disabled={checkingUpdate}
            style={{ padding: '8px 20px', flex: 'none' }}
          >
            {checkingUpdate ? 'Checking...' : 'Check for Updates'}
          </button>
          {/* Fixed height so status text doesn't shift layout */}
          <div style={{ minHeight: '1.5em' }}>
            {updateStatus && (
              <p className="form-hint" style={{ textAlign: 'center', maxWidth: '360px', margin: 0 }}>
                {updateStatus}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Links + footer at bottom */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <a
            href="https://github.com/thesubtleties/sbtlTV"
            target="_blank"
            rel="noopener noreferrer"
            title="GitHub"
            style={{ color: 'rgba(255, 255, 255, 0.25)', transition: 'color 0.15s ease', display: 'flex' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.25)'; }}
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
            style={{ color: 'rgba(255, 255, 255, 0.25)', transition: 'color 0.15s ease', display: 'flex' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.25)'; }}
          >
            <SbtlMark width="28" height="22" />
          </a>
        </div>

        <p className="settings-disclaimer" style={{ marginTop: 0 }}>
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
