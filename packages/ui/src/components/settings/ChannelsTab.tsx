import { useSetChannelSortOrder, useSetCategoryBarWidth, useSetGuideOpacity } from '../../stores/uiStore';

interface EpgTabProps {
  channelSortOrder: 'alphabetical' | 'number';
  onChannelSortOrderChange: (order: 'alphabetical' | 'number') => void;
  categoryBarWidth: number;
  guideOpacity: number;
  onCategoryBarWidthChange: (width: number) => void;
  onGuideOpacityChange: (opacity: number) => void;
}

export function EpgTab({
  channelSortOrder,
  onChannelSortOrderChange,
  categoryBarWidth,
  guideOpacity,
  onCategoryBarWidthChange,
  onGuideOpacityChange,
}: EpgTabProps) {
  const setChannelSortOrder = useSetChannelSortOrder();
  const setCategoryBarWidth = useSetCategoryBarWidth();
  const setGuideOpacity = useSetGuideOpacity();

  async function handleSortOrderChange(order: 'alphabetical' | 'number') {
    onChannelSortOrderChange(order);
    setChannelSortOrder(order);
    if (!window.storage) return;
    await window.storage.updateSettings({ channelSortOrder: order });
  }

  function handleWidthChange(width: number) {
    onCategoryBarWidthChange(width);
    setCategoryBarWidth(width);
    window.storage?.updateSettings({ categoryBarWidth: width });
  }

  function handleOpacityChange(pct: number) {
    const opacity = pct / 100;
    onGuideOpacityChange(opacity);
    setGuideOpacity(opacity);
    window.storage?.updateSettings({ guideOpacity: opacity });
  }

  return (
    <div className="settings-tab-content">
      <div className="settings-section">
        <div className="section-header">
          <h3>Channel Display</h3>
        </div>

        <p className="section-description">
          Configure how channels are sorted in the guide.
        </p>

        <div className="refresh-settings">
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
        </div>

        <p className="form-hint" style={{ marginTop: '0.75rem' }}>
          "Channel Number" uses the order from your provider (Xtream num or M3U tvg-chno).
          Channels without a number will appear at the end, sorted alphabetically.
        </p>
      </div>

      <div className="settings-section">
        <div className="section-header">
          <h3>Guide Appearance</h3>
        </div>

        <p className="section-description">
          Adjust the category sidebar width and background opacity of the guide overlay.
        </p>

        {/* Category Width Slider */}
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
          />
          <div className="slider-labels">
            <span>Narrow</span>
            <span>Wide</span>
          </div>
        </div>

        {/* Live preview */}
        <div
          className="width-preview"
          style={{
            width: `${categoryBarWidth}px`,
            background: `rgb(0 0 0 / ${guideOpacity})`,
          }}
        >
          <div className="width-preview-item selected">
            <span className="width-preview-name">All Channels</span>
          </div>
          <div className="width-preview-item">
            <span className="width-preview-name">Entertainment &amp; Movies HD</span>
          </div>
          <div className="width-preview-item">
            <span className="width-preview-name">Sports</span>
          </div>
        </div>

        {/* Background Opacity Slider */}
        <div className="form-group" style={{ marginTop: '20px' }}>
          <label>Background Opacity</label>
          <input
            type="range"
            className="settings-slider"
            min={50}
            max={100}
            step={5}
            value={Math.round(guideOpacity * 100)}
            onChange={(e) => handleOpacityChange(Number(e.target.value))}
          />
          <div className="slider-labels">
            <span>Light</span>
            <span>Dark</span>
          </div>
        </div>
      </div>
    </div>
  );
}
