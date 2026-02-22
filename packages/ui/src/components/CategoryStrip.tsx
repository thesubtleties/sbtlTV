import { useGroupedCategories, useChannelCount, type GroupedCategory } from '../hooks/useChannels';
import './CategoryStrip.css';

interface CategoryStripProps {
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  visible: boolean;
  sidebarExpanded: boolean;
}

export function CategoryStrip({ selectedCategoryId, onSelectCategory, visible, sidebarExpanded }: CategoryStripProps) {
  const groupedCategories = useGroupedCategories();
  const totalChannels = useChannelCount();

  return (
    <div className={`category-strip ${visible ? 'visible' : 'hidden'} ${sidebarExpanded ? 'sidebar-expanded' : ''}`}>
      <div className="category-strip-header">
        <span className="category-strip-title">Categories</span>
      </div>

      <div className="category-strip-list">
        {/* "All Channels" option */}
        <button
          className={`category-item ${selectedCategoryId === null ? 'selected' : ''}`}
          onClick={() => onSelectCategory(null)}
        >
          <span className="category-name">All Channels</span>
          <span className="category-count">{totalChannels}</span>
        </button>

        {/* Adaptive category list */}
        {groupedCategories.map((group) =>
          group.sources.length === 1 ? (
            // Single source: flat clickable item (same as before)
            <button
              key={group.sources[0].categoryId}
              className={`category-item ${selectedCategoryId === group.sources[0].categoryId ? 'selected' : ''}`}
              onClick={() => onSelectCategory(group.sources[0].categoryId)}
            >
              <span className="category-name">{group.name}</span>
              <span className="category-count">{group.totalCount}</span>
            </button>
          ) : (
            // Multi-source: non-clickable header + clickable sub-items per source
            <div key={group.name} className="category-group">
              <div className="category-group-header">
                <span className="category-group-name">{group.name}</span>
                <span className="category-count">{group.totalCount}</span>
              </div>
              {group.sources.map((src) => (
                <button
                  key={src.categoryId}
                  className={`category-item category-sub-item ${selectedCategoryId === src.categoryId ? 'selected' : ''}`}
                  onClick={() => onSelectCategory(src.categoryId)}
                >
                  <span className="category-name">{src.sourceName}</span>
                  <span className="category-count">{src.channelCount}</span>
                </button>
              ))}
            </div>
          )
        )}

        {groupedCategories.length === 0 && (
          <div className="category-empty">
            <p>No categories yet</p>
            <p className="hint">Add a source in Settings</p>
          </div>
        )}
      </div>
    </div>
  );
}
