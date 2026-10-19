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
  | 'appearance'
  | 'subtitles'
  | 'liveplayback'
  | 'player'
  | 'security'
  | 'privacy'
  | 'backup'
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
    ],
  },
  {
    label: 'Live TV',
    tabs: [
      { id: 'channels', label: 'Guide' },
      { id: 'liveplayback', label: 'Live playback' },
    ],
  },
  {
    label: 'Movies & Series',
    tabs: [
      { id: 'movies', label: 'Movies' },
      { id: 'series', label: 'Series' },
      { id: 'subtitles', label: 'Subtitles' },
      { id: 'tmdb', label: 'TMDB' },
      { id: 'posterdb', label: 'Poster DB' },
    ],
  },
  {
    label: 'System',
    tabs: [
      { id: 'appearance', label: 'Appearance' },
      { id: 'player', label: 'Video Player' },
      { id: 'security', label: 'Security' },
      { id: 'privacy', label: 'Privacy' },
      { id: 'backup', label: 'Backup & transfer' },
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
