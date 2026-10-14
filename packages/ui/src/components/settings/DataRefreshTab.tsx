import { useState } from 'react';
import { data } from '../../data/client';
import { useCacheClearing, useSetCacheClearing, useUpdateSettings } from '../../stores/uiStore';
import { Button, OptionRow, Section, Segmented, SettingsTab } from './ui';

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
  const [showConfirm, setShowConfirm] = useState(false);
  const isClearing = useCacheClearing();
  const setCacheClearing = useSetCacheClearing();
  const updateSettings = useUpdateSettings();

  async function saveRefreshSettings(vod: number, epg: number) {
    updateSettings({ vodRefreshHours: vod, epgRefreshHours: epg });
    if (!window.storage) return;
    await window.storage.updateSettings({ vodRefreshHours: vod, epgRefreshHours: epg });
  }

  async function handleClearCache() {
    setCacheClearing(true);
    setShowConfirm(false);
    try {
      // The data process empties its tables, then resyncs every source; the
      // banner follows its progress events. Watch progress and favorites stay.
      await data.query({ type: 'clearAll' });
      await data.query({ type: 'syncNow', what: 'all' });
    } catch (error) {
      console.error('[Settings] Failed to clear cache:', error);
    } finally {
      setCacheClearing(false);
    }
  }

  const vodOptions = [
    { id: '0', label: 'Manual' }, { id: '6', label: '6h' }, { id: '12', label: '12h' },
    { id: '24', label: 'Daily' }, { id: '48', label: '2 days' }, { id: '168', label: 'Weekly' },
  ];
  const epgOptions = [
    { id: '0', label: 'Manual' }, { id: '3', label: '3h' }, { id: '6', label: '6h' },
    { id: '12', label: '12h' }, { id: '24', label: 'Daily' },
  ];
  const describe = (hours: number, what: string) => hours === 0
    ? `${what} refreshes only when you sync it yourself.`
    : `${what} refreshes at startup when it is more than ${hours === 168 ? 'a week' : hours === 48 ? '2 days' : hours === 24 ? 'a day' : `${hours} hours`} old.`;

  return (
    <SettingsTab>
      <Section title="Data refresh" description="How often sbtlTV refreshes your sources' data when it starts.">
        <OptionRow title="Movies & series" help={describe(vodRefreshHours, 'The movie and series library')}>
          <Segmented
            compact
            value={String(vodRefreshHours)}
            options={vodOptions}
            onChange={(id) => {
              const hours = Number(id);
              onVodRefreshChange(hours);
              void saveRefreshSettings(hours, epgRefreshHours);
            }}
          />
        </OptionRow>
        <OptionRow title="TV guide" help={describe(epgRefreshHours, 'The program guide')}>
          <Segmented
            compact
            value={String(epgRefreshHours)}
            options={epgOptions}
            onChange={(id) => {
              const hours = Number(id);
              onEpgRefreshChange(hours);
              void saveRefreshSettings(vodRefreshHours, hours);
            }}
          />
        </OptionRow>
      </Section>

      <Section
        title="Clear cache"
        description="Removes all cached channels, guide data and movies and series, then syncs every source again. Use it for duplicate entries, a stale guide, or data that will not update. Sources, settings, watch progress and favorites stay."
      >
        <div className="st-confirm">
          {isClearing ? (
            <Button variant="danger" disabled>Clearing…</Button>
          ) : !showConfirm ? (
            <Button variant="danger" onClick={() => setShowConfirm(true)}>Clear cached data</Button>
          ) : (
            <>
              <span className="st-confirm__question">Delete all cached data and sync again?</span>
              <Button variant="danger" onClick={() => void handleClearCache()}>Yes, clear</Button>
              <Button onClick={() => setShowConfirm(false)}>Cancel</Button>
            </>
          )}
        </div>
      </Section>
    </SettingsTab>
  );
}
