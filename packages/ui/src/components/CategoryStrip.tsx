import { useRef, useMemo, useCallback } from 'react';
import { useGroupedCategories, useChannelCount } from '../hooks/useChannels';
import { useFavoriteChannelCount } from '../hooks/useFavorites';
import { useCategoryFilter, useSetCategoryFilter } from '../stores/uiStore';
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
  const favoriteCount = useFavoriteChannelCount();
  const categoryFilter = useCategoryFilter();
  const setCategoryFilter = useSetCategoryFilter();
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCategories = useMemo(() => {
    if (!categoryFilter) return groupedCategories;
    const q = categoryFilter.toLowerCase();
    return groupedCategories.filter(g => g.name.toLowerCase().includes(q));
  }, [groupedCategories, categoryFilter]);

  const handleClear = useCallback(() => {
    setCategoryFilter('');
    inputRef.current?.focus();
  }, [setCategoryFilter]);

  return (
    <div className={`category-strip ${visible ? 'visible' : 'hidden'} ${sidebarExpanded ? 'sidebar-expanded' : ''}`}>
      <div className="category-strip-header">
        <span className="category-strip-title">Categories</span>
      </div>

      <div className="category-filter">
        <svg className="category-filter__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
          <path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
          <path d="M21 21l-6 -6" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="category-filter__input"
          placeholder="Filter"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          spellCheck={false}
        />
        {categoryFilter && (
          <button className="category-filter__clear" onClick={handleClear} tabIndex={-1}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="category-strip-list">
        {/* "All Channels" option — always visible */}
        <button
          className={`category-item ${selectedCategoryId === null ? 'selected' : ''}`}
          onClick={() => onSelectCategory(null)}
        >
          <span className="category-name">All Channels</span>
          <span className="category-count">{totalChannels}</span>
        </button>

        {/* Favorites — always visible when present */}
        {favoriteCount > 0 && (
          <button
            className={`category-item ${selectedCategoryId === '__favorites__' ? 'selected' : ''}`}
            onClick={() => onSelectCategory('__favorites__')}
          >
            <span className="category-name">Favorites</span>
            <span className="category-count">{favoriteCount}</span>
          </button>
        )}

        {/* Filtered category list */}
        {filteredCategories.map((group) =>
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
