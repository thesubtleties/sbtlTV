interface DataRefreshTabProps {
  vodRefreshHours: number;
  epgRefreshHours: number;
  onVodRefreshChange: (hours: number) => void;
  onEpgRefreshChange: (hours: number) => void;
}

export function DataRefreshTab({
  vodRefreshHours,
  epgRefreshHours,
  onVodRefreshChange,
  onEpgRefreshChange,
}: DataRefreshTabProps) {
  async function saveRefreshSettings(vod: number, epg: number) {
    if (!window.storage) return;
    await window.storage.updateSettings({ vodRefreshHours: vod, epgRefreshHours: epg });
  }

  return (
    <div className="settings-tab-content">
      <div className="settings-section">
        <div className="section-header">
          <h3>Data Refresh</h3>
        </div>
        <p className="section-description">
          Configure how often data is automatically refreshed on app startup.
          Set to "Manual only" to disable automatic refresh.
        </p>

        <div className="refresh-settings">
          <div className="form-group inline">
            <label>VOD (Movies & Series)</label>
            <select
              value={vodRefreshHours}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                onVodRefreshChange(val);
                saveRefreshSettings(val, epgRefreshHours);
              }}
            >
              <option value={0}>Manual only</option>
              <option value={6}>Every 6 hours</option>
              <option value={12}>Every 12 hours</option>
              <option value={24}>Every 24 hours</option>
              <option value={48}>Every 2 days</option>
              <option value={168}>Every week</option>
            </select>
          </div>

          <div className="form-group inline">
            <label>EPG (TV Guide)</label>
            <select
              value={epgRefreshHours}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                onEpgRefreshChange(val);
                saveRefreshSettings(vodRefreshHours, val);
              }}
            >
              <option value={0}>Manual only</option>
              <option value={3}>Every 3 hours</option>
              <option value={6}>Every 6 hours</option>
              <option value={12}>Every 12 hours</option>
              <option value={24}>Every 24 hours</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
