import { useCategoriesWithCounts, type CategoryWithCount } from '../hooks/useChannels';
import './CategoryStrip.css';

interface CategoryStripProps {
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  visible: boolean;
  sidebarExpanded: boolean;
}

export function CategoryStrip({ selectedCategoryId, onSelectCategory, visible, sidebarExpanded }: CategoryStripProps) {
  const categories = useCategoriesWithCounts();

  // Calculate total channel count for "All" option
  const totalChannels = categories.reduce((sum, cat) => sum + cat.channelCount, 0);

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

        {/* Category list */}
        {categories.map((category) => (
          <button
            key={category.category_id}
            className={`category-item ${selectedCategoryId === category.category_id ? 'selected' : ''}`}
            onClick={() => onSelectCategory(category.category_id)}
          >
            <span className="category-name">{category.category_name}</span>
            <span className="category-count">{category.channelCount}</span>
          </button>
        ))}

        {categories.length === 0 && (
          <div className="category-empty">
            <p>No categories yet</p>
            <p className="hint">Add a source in Settings</p>
          </div>
        )}
      </div>
    </div>
  );
}
