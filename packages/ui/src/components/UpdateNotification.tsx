import { useState } from 'react';
import { useUpdaterState, useUpdaterDismissed, useDismissUpdater, useSetUpdaterState } from '../stores/uiStore';
import './UpdateNotification.css';

function debugLog(message: string): void {
  const logMsg = `[updater] ${message}`;
  console.log(logMsg);
  if (window.debug?.logFromRenderer) {
    window.debug.logFromRenderer(logMsg).catch(() => {});
  }
}

export function UpdateNotification() {
  const updaterState = useUpdaterState();
  const dismissed = useUpdaterDismissed();
  const dismiss = useDismissUpdater();
  const setUpdaterState = useSetUpdaterState();
  const [error, setError] = useState<string | null>(null);

  if (updaterState.phase !== 'ready' || dismissed) return null;

  const handleInstall = async () => {
    if (!window.updater) return;
    try {
      const result = await window.updater.installUpdate();
      if (result?.error) {
        debugLog(`Install failed: ${result.error}`);
        setError('Update failed. Please restart manually.');
        setUpdaterState({ phase: 'error', message: result.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Install failed';
      debugLog(`Install error: ${msg}`);
      setError('Update failed. Please restart manually.');
      setUpdaterState({ phase: 'error', message: 'Failed to install update' });
    }
  };

  return (
    <div className="update-notification">
      <div className="update-notification__content">
        <div className="update-notification__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>
        <div className="update-notification__text">
          {error ? (
            <>
              <strong>Update failed</strong>
              <span>{error}</span>
            </>
          ) : (
            <>
              <strong>v{updaterState.version} available</strong>
              <span>Restart to install</span>
            </>
          )}
        </div>
      </div>
      <div className="update-notification__actions">
        <button
          className="update-notification__btn update-notification__btn--later"
          onClick={dismiss}
        >
          Later
        </button>
        {!error && (
          <button
            className="update-notification__btn update-notification__btn--install"
            onClick={handleInstall}
          >
            Restart
          </button>
        )}
      </div>
    </div>
  );
}
