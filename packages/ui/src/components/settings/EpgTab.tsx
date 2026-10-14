import { useUpdateSettings } from '../../stores/uiStore';
import { data } from '../../data/client';
import { useToast } from '../../hooks/useToast';
import { debugLog } from '../../utils/debugLog';
import { OnOff, OptionRow, Section, Segmented, SettingsTab, Slider } from './ui';

interface EpgTabProps {
  channelSortOrder: 'alphabetical' | 'number';
  onChannelSortOrderChange: (order: 'alphabetical' | 'number') => void;
  categorySortOrder: 'alphabetical' | 'provider';
  onCategorySortOrderChange: (order: 'alphabetical' | 'provider') => void;
  categoryBarWidth: number;
  channelColumnWidth: number;
  guideOpacity: number;
  onCategoryBarWidthChange: (width: number) => void;
  onChannelColumnWidthChange: (width: number) => void;
  onGuideOpacityChange: (opacity: number) => void;
  sportsMatchupEnabled: boolean;
  onSportsMatchupChange: (enabled: boolean) => void;
  guideMorphEnabled: boolean;
  onGuideMorphChange: (enabled: boolean) => void;
}

export function EpgTab({
  channelSortOrder,
  onChannelSortOrderChange,
  categorySortOrder,
  onCategorySortOrderChange,
  categoryBarWidth,
  channelColumnWidth,
  guideOpacity,
  onCategoryBarWidthChange,
  onChannelColumnWidthChange,
  onGuideOpacityChange,
  sportsMatchupEnabled,
  onSportsMatchupChange,
  guideMorphEnabled,
  onGuideMorphChange,
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
    // The data process runs the sync; the banner follows its progress events.
    let progress: ReturnType<typeof toast.progress> | undefined;
    try {
      const cats = await data.query({ type: 'categories', sourceIds: [] });
      const ready = cats.some((c) => c.position != null);
      if (ready) return;

      progress = toast.progress('Preparing provider order…', 'Re-syncing your channels');
      if (cats.length === 0) {
        progress.fail('No channels to sync', 'Add a source in the Sources tab first');
      } else {
        await data.query({ type: 'syncNow', what: 'channels' });
        progress.succeed('Provider order ready once the sync finishes', 'Check the Sources tab for progress');
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

  async function handleChannelWidthChange(width: number) {
    onChannelColumnWidthChange(width);
    updateSettings({ channelColumnWidth: width });
    if (!window.storage) return;
    await window.storage.updateSettings({ channelColumnWidth: width });
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

  async function handleGuideMorphChange(enabled: boolean) {
    onGuideMorphChange(enabled);
    updateSettings({ guideMorphEnabled: enabled });
    if (!window.storage) return;
    await window.storage.updateSettings({ guideMorphEnabled: enabled });
  }

  return (
    <SettingsTab>
      <Section title="Channels" description="How channels and categories are ordered in the guide.">
        <OptionRow
          title="Channel order"
          help={channelSortOrder === 'number'
            ? "Your provider's channel numbers (Xtream num or M3U tvg-chno). Channels without a number come last, alphabetically."
            : 'Alphabetical, A to Z.'}
        >
          <Segmented
            value={channelSortOrder}
            options={[{ id: 'alphabetical', label: 'A to Z' }, { id: 'number', label: 'Number' }]}
            onChange={(order) => void handleSortOrderChange(order)}
          />
        </OptionRow>
        <OptionRow
          title="Category order"
          help={categorySortOrder === 'provider'
            ? "Your source's own arrangement, so the folders your provider put on top stay on top. With several sources, the highest-priority one sets the layout."
            : 'Alphabetical, A to Z.'}
        >
          <Segmented
            value={categorySortOrder}
            options={[{ id: 'alphabetical', label: 'A to Z' }, { id: 'provider', label: 'Provider' }]}
            onChange={(order) => void handleCategorySortOrderChange(order)}
          />
        </OptionRow>
      </Section>

      <Section title="Guide layout" description="Sizes and background of the guide over the video.">
        <OptionRow title="Category width" help="The category column on the left.">
          <Slider
            min={120}
            max={400}
            step={10}
            value={categoryBarWidth}
            onChange={(width) => void handleWidthChange(width)}
            format={(value) => `${value} px`}
            label="Category sidebar width"
          />
        </OptionRow>
        <OptionRow title="Channel column" help="The channel names and logos beside the programs.">
          <Slider
            min={220}
            max={520}
            step={10}
            value={channelColumnWidth}
            onChange={(width) => void handleChannelWidthChange(width)}
            format={(value) => `${value} px`}
            label="Channel column width"
          />
        </OptionRow>
        <OptionRow title="Background" help="How much of the video shows through the guide. Lower is more see-through.">
          <Slider
            min={50}
            max={100}
            step={5}
            value={Math.round(guideOpacity * 100)}
            onChange={(pct) => void handleOpacityChange(pct)}
            format={(value) => `${value}%`}
            label="Guide background opacity"
          />
        </OptionRow>
      </Section>

      <Section title="Sports">
        <OptionRow
          title="Team logos"
          help={sportsMatchupEnabled
            ? "On a live channel showing a recognized game, the bar shows both teams' logos instead of the channel icon. Matched from the guide for NFL, NBA, MLB, NHL and college football and basketball; scores are never shown. The logos load from ESPN, which sees your IP address and which teams."
            : "The bar shows the channel icon. Turn this on to show both teams' logos on a recognized live game instead. The logos load from ESPN, which sees your IP address and which teams. Off by default on new installs since 0.12.1."}
        >
          <OnOff value={sportsMatchupEnabled} onChange={(enabled) => void handleSportsMatchupChange(enabled)} />
        </OptionRow>
      </Section>

      <Section title="Loading">
        <OptionRow
          title="Animate programs"
          help={guideMorphEnabled
            ? 'When guide rows take a moment to load, their titles fade in and slide into position.'
            : 'Program titles simply fade in.'}
        >
          <OnOff value={guideMorphEnabled} onChange={(enabled) => void handleGuideMorphChange(enabled)} />
        </OptionRow>
      </Section>
    </SettingsTab>
  );
}
