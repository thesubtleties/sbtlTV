import { useState, useEffect } from 'react';
import type { UpdateInfo } from '../types/electron';
import './UpdateNotification.css';

export function UpdateNotification() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Real updater events (packaged builds)
    if (window.updater) {
      window.updater.onUpdateDownloaded((info) => {
        setUpdateInfo(info);
        setDismissed(false);
      });
    }

    // Test event (dispatch via console: window.dispatchEvent(new CustomEvent('test-update-notification', { detail: { version: '1.0.0', releaseDate: '2026-01-01' } })))
    const handleTestUpdate = (e: Event) => {
      setUpdateInfo((e as CustomEvent).detail);
      setDismissed(false);
    };
    window.addEventListener('test-update-notification', handleTestUpdate);

    return () => {
      window.updater?.removeAllListeners();
      window.removeEventListener('test-update-notification', handleTestUpdate);
    };
  }, []);

  if (!updateInfo || dismissed) return null;

  const handleInstall = async () => {
    if (!window.updater) return;
    try {
      const result = await window.updater.installUpdate();
      if (result?.error) {
        console.error('Failed to install update:', result.error);
      }
    } catch (err) {
      console.error('Failed to install update:', err);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
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
          <strong>v{updateInfo.version} available</strong>
          <span>Restart to install</span>
        </div>
      </div>
      <div className="update-notification__actions">
        <button
          className="update-notification__btn update-notification__btn--later"
          onClick={handleDismiss}
        >
          Later
        </button>
        <button
          className="update-notification__btn update-notification__btn--install"
          onClick={handleInstall}
        >
          Restart
        </button>
      </div>
    </div>
  );
}
