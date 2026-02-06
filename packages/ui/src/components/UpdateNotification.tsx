import { useState, useEffect } from 'react';
import type { UpdateInfo } from '../types/electron';
import './UpdateNotification.css';

export function UpdateNotification() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.updater) return;

    window.updater.onUpdateDownloaded((info) => {
      setUpdateInfo(info);
      setDismissed(false);
    });

    return () => {
      window.updater?.removeAllListeners();
    };
  }, []);

  if (!updateInfo || dismissed) return null;

  const handleInstall = () => {
    window.updater?.installUpdate();
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  return (
    <div className="update-notification">
      <div className="update-notification__content">
        <div className="update-notification__icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>
        <div className="update-notification__text">
          <strong>Update v{updateInfo.version} ready</strong>
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
          Install Now
        </button>
      </div>
    </div>
  );
}
