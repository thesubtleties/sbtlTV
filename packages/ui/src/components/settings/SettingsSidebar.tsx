import './SettingsSidebar.css';

export type SettingsTabId =
  | 'sources'
  | 'priority'
  | 'tmdb'
  | 'refresh'
  | 'channels'
  | 'movies'
  | 'series'
  | 'posterdb'
  | 'security'
  | 'debug'
  | 'about';

interface SettingsCategory {
  label: string;
  tabs: {
    id: SettingsTabId;
    label: string;
    hidden?: boolean;
  }[];
}

const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    label: 'Content',
    tabs: [
      { id: 'sources', label: 'Sources' },
      { id: 'priority', label: 'Priority' },
      { id: 'refresh', label: 'Data Refresh' },
      { id: 'tmdb', label: 'TMDB' },
      { id: 'posterdb', label: 'Poster DB' },
    ],
  },
  {
    label: 'Library',
    tabs: [
      { id: 'channels', label: 'EPG' },
      { id: 'movies', label: 'Movies' },
      { id: 'series', label: 'Series' },
    ],
  },
  {
    label: 'System',
    tabs: [
      { id: 'security', label: 'Security' },
      { id: 'debug', label: 'Debug' },
      { id: 'about', label: 'About' },
    ],
  },
];

interface SettingsSidebarProps {
  activeTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  hasXtreamSource: boolean;
  hasMultipleSources: boolean;
}

export function SettingsSidebar({
  activeTab,
  onTabChange,
  hasXtreamSource,
  hasMultipleSources,
}: SettingsSidebarProps) {
  return (
    <nav className="settings-sidebar">
      {SETTINGS_CATEGORIES.map((category, categoryIndex) => (
        <div key={categoryIndex} className="settings-category">
          {category.label && (
            <div className="settings-category-header">{category.label}</div>
          )}
          {category.tabs.map((tab) => {
            // Hide Movies/Series tabs if no Xtream source
            const isLibraryTab = tab.id === 'movies' || tab.id === 'series';
            if (isLibraryTab && !hasXtreamSource) {
              return null;
            }
            // Hide Priority tab if only one source
            if (tab.id === 'priority' && !hasMultipleSources) {
              return null;
            }

            return (
              <button
                key={tab.id}
                className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => onTabChange(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
