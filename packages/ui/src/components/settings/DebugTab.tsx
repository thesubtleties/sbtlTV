import { useState, useEffect } from 'react';

interface DebugTabProps {
  debugLoggingEnabled: boolean;
  onDebugLoggingChange: (enabled: boolean) => void;
}

export function DebugTab({
  debugLoggingEnabled,
  onDebugLoggingChange,
}: DebugTabProps) {
  const [logPath, setLogPath] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Get log file path on mount
    if (window.debug) {
      window.debug.getLogPath().then((result) => {
        if (result.data) {
          setLogPath(result.data);
        }
      });
    }
  }, []);

  async function handleDebugLoggingChange(enabled: boolean) {
    if (!window.storage) return;
    onDebugLoggingChange(enabled);
    await window.storage.updateSettings({ debugLoggingEnabled: enabled });
  }

  async function handleOpenLogFolder() {
    if (window.debug) {
      await window.debug.openLogFolder();
    }
  }

  async function handleCopyGitHub() {
    try {
      await navigator.clipboard.writeText('https://github.com/thesubtleties/sbtlTV/issues');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Clipboard write failed:', err);
    }
  }

  return (
    <div className="settings-tab-content">
      <div className="settings-section">
        <div className="section-header">
          <h3>Debug Logging</h3>
        </div>

        <p className="section-description">
          Enable verbose logging to help diagnose issues with video playback,
          network requests, and application errors. Logs are written to a file
          that you can share when reporting bugs.
        </p>

        <div className="tmdb-form" style={{ marginTop: '1rem' }}>
          <label className="genre-checkbox" style={{ maxWidth: '320px' }}>
            <input
              type="checkbox"
              checked={debugLoggingEnabled}
              onChange={(e) => handleDebugLoggingChange(e.target.checked)}
            />
            <span className="genre-name">Enable debug logging</span>
          </label>
          <p className="form-hint" style={{ marginTop: '0.5rem' }}>
            When enabled, detailed logs from mpv, the renderer, and main process
            are written to a file. This may slightly impact performance.
          </p>
          <p className="form-hint" style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Report issues at{' '}
            <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>github.com/thesubtleties/sbtlTV/issues</span>
            <button
              onClick={handleCopyGitHub}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '2px 6px',
                fontSize: '0.75rem',
                opacity: 0.8,
              }}
            >
              {copied ? '✓' : 'copy'}
            </button>
          </p>
        </div>

        {logPath && (
          <div style={{ marginTop: '1.5rem' }}>
            <h4 style={{ marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Log File Location
            </h4>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              backgroundColor: 'var(--bg-tertiary)',
              padding: '0.75rem 1rem',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              wordBreak: 'break-all'
            }}>
              <span style={{ flex: 1 }}>{logPath}</span>
              <button
                onClick={handleOpenLogFolder}
                className="sync-button"
                style={{
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.8rem',
                  whiteSpace: 'nowrap'
                }}
              >
                Open Folder
              </button>
            </div>
          </div>
        )}

      </div>

      <p className="settings-disclaimer">
        Debug logs may contain sensitive information like stream URLs. Only share
        logs with trusted parties when troubleshooting issues.
      </p>
    </div>
  );
}
