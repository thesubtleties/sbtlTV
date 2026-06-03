import { useUpdateSettings } from '../../stores/uiStore';
import { db } from '../../db';
import { syncAllSources } from '../../db/sync';
import { useToast } from '../../hooks/useToast';
import { debugLog } from '../../utils/debugLog';

interface EpgTabProps {
  channelSortOrder: 'alphabetical' | 'number';
  onChannelSortOrderChange: (order: 'alphabetical' | 'number') => void;
  categorySortOrder: 'alphabetical' | 'provider';
  onCategorySortOrderChange: (order: 'alphabetical' | 'provider') => void;
  categoryBarWidth: number;
  guideOpacity: number;
  onCategoryBarWidthChange: (width: number) => void;
  onGuideOpacityChange: (opacity: number) => void;
  sportsMatchupEnabled: boolean;
  onSportsMatchupChange: (enabled: boolean) => void;
}

export function EpgTab({
  channelSortOrder,
  onChannelSortOrderChange,
  categorySortOrder,
  onCategorySortOrderChange,
  categoryBarWidth,
  guideOpacity,
  onCategoryBarWidthChange,
  onGuideOpacityChange,
  sportsMatchupEnabled,
  onSportsMatchupChange,
}: EpgTabProps) {
  const updateSettings = useUpdateSettings();
  const toast = useToast();

  async function handleSortOrderChange(order: 'alphabetical' | 'number') {
    onChannelSortOrderChange(order);
    updateSettings({ channelSortOrder: order });
    if (!window.storage) return;
    await window.storage.updateSettings({ channelSortOrder: order });
  }

  async function handleCategorySortOrderChange(order: 'alphabetical' | 'provider') {
    onCategorySortOrderChange(order);
    updateSettings({ categorySortOrder: order });
    if (window.storage) {
      await window.storage.updateSettings({ categorySortOrder: order });
    }
    if (order !== 'provider') return;

    // Provider order needs per-category `position`; backfill via resync if absent.
    // syncAllSources() only throws on infra errors — per-source failures come back
    // in the result map, so inspect it rather than trusting a non-throw as success.
    let progress: ReturnType<typeof toast.progress> | undefined;
    try {
      const ready = (await db.categories.where('position').aboveOrEqual(0).count()) > 0;
      if (ready) return;

      progress = toast.progress('Preparing provider order…', 'Re-syncing your channels');
      const results = await syncAllSources();
      const failed = [...results.values()].filter((r) => !r.success).length;

      if (results.size === 0) {
        progress.fail('No channels to sync', 'Add a source in the Sources tab first');
      } else if (failed === results.size) {
        progress.fail('Could not prepare provider order', 'Try syncing from the Sources tab');
      } else if (failed > 0) {
        progress.succeed('Provider order ready', 'Some sources failed — check the Sources tab');
      } else {
        progress.succeed('Provider order ready');
      }
    } catch (err) {
      debugLog(`[category-sort] provider-order resync failed: ${err instanceof Error ? err.message : String(err)}`, 'sync');
      if (progress) {
        progress.fail('Could not prepare provider order', 'Try syncing from the Sources tab');
      } else {
        toast.error('Could not prepare provider order', 'Try again or restart the app');
      }
    }
  }

  async function handleWidthChange(width: number) {
    onCategoryBarWidthChange(width);
    updateSettings({ categoryBarWidth: width });
    if (!window.storage) return;
    await window.storage.updateSettings({ categoryBarWidth: width });
  }

  async function handleOpacityChange(pct: number) {
    const opacity = pct / 100;
    onGuideOpacityChange(opacity);
    updateSettings({ guideOpacity: opacity });
    if (!window.storage) return;
    await window.storage.updateSettings({ guideOpacity: opacity });
  }

  async function handleSportsMatchupChange(enabled: boolean) {
    onSportsMatchupChange(enabled);
    updateSettings({ sportsMatchupEnabled: enabled });
    if (!window.storage) return;
    await window.storage.updateSettings({ sportsMatchupEnabled: enabled });
  }

  return (
    <div className="settings-tab-content epg-tab-scroll">
      <div className="settings-section">
        <div className="section-header">
          <h3>Channel Display</h3>
        </div>

        <p className="section-description">
          Configure how channels are sorted in the guide.
        </p>

        <div className="form-group inline">
          <label>Sort Order</label>
          <select
            value={channelSortOrder}
            onChange={(e) => handleSortOrderChange(e.target.value as 'alphabetical' | 'number')}
          >
            <option value="alphabetical">Alphabetical (A-Z)</option>
            <option value="number">Channel Number</option>
          </select>
        </div>

        <p className="form-hint">
          "Channel Number" uses the order from your provider (Xtream num or M3U tvg-chno).
          Channels without a number will appear at the end, sorted alphabetically.
        </p>

        <div className="form-group inline">
          <label>Category Order</label>
          <select
            value={categorySortOrder}
            onChange={(e) => handleCategorySortOrderChange(e.target.value as 'alphabetical' | 'provider')}
          >
            <option value="alphabetical">Alphabetical (A-Z)</option>
            <option value="provider">Provider Order</option>
          </select>
        </div>

        <p className="form-hint">
          "Provider Order" keeps the category arrangement from your source, so the
          folders your provider curated at the top stay on top. With multiple sources,
          your highest-priority source defines the layout.
        </p>
      </div>

      <div className="settings-section">
        <div className="section-header">
          <h3>Guide Appearance</h3>
        </div>

        <p className="section-description">
          Adjust the category sidebar width and background opacity of the guide overlay.
        </p>

        <div className="form-group">
          <label>Category Width</label>
          <input
            type="range"
            className="settings-slider"
            min={120}
            max={400}
            step={10}
            value={categoryBarWidth}
            onChange={(e) => handleWidthChange(Number(e.target.value))}
            aria-label="Category sidebar width"
          />
          <div className="slider-labels">
            <span>Narrow</span>
            <span>Wide</span>
          </div>
        </div>

        <div className="form-group">
          <label>Background Opacity</label>
          <input
            type="range"
            className="settings-slider"
            min={50}
            max={100}
            step={5}
            value={Math.round(guideOpacity * 100)}
            onChange={(e) => handleOpacityChange(Number(e.target.value))}
            aria-label="Guide background opacity"
          />
          <div className="slider-labels">
            <span>Light</span>
            <span>Dark</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="section-header">
          <h3>Sports</h3>
        </div>

        <p className="section-description">
          When you're on a live channel showing a recognized game, the bar shows the two team
          logos instead of the channel icon. Scores are never shown.
        </p>

        <div className="tmdb-form" style={{ marginTop: '1rem' }}>
          <label className="genre-checkbox" style={{ maxWidth: '320px' }}>
            <input
              type="checkbox"
              checked={sportsMatchupEnabled}
              onChange={(e) => handleSportsMatchupChange(e.target.checked)}
            />
            <span className="genre-name">Show team logos for live games</span>
          </label>
          <p className="form-hint" style={{ marginTop: '0.5rem' }}>
            Matched from the program guide for NFL, NBA, MLB, NHL, and college football/basketball.
            Shows nothing when a game can't be confidently identified.
          </p>
        </div>
      </div>
    </div>
  );
}
