import { useEffect, useMemo } from 'react';
import { useUpdateSettings } from '../../stores/uiStore';
import type { AppSettings } from '../../types/electron';

interface GenreCarouselTabProps {
  tmdbApiKey: string | null;
  enabledGenres: number[] | undefined;
  onEnabledGenresChange: (genres: number[]) => void;
  settingsLoaded: boolean;
  useGenres: (key: string | null) => { genres: { id: number; name: string }[]; loading: boolean };
  useMultipleByGenre: (key: string | null, ids: number[]) => Map<number, { items: unknown[]; loading: boolean }>;
  settingsKey: keyof Pick<AppSettings, 'movieGenresEnabled' | 'seriesGenresEnabled'>;
  title: string;
  description: string;
}

export function GenreCarouselTab({
  tmdbApiKey,
  enabledGenres,
  onEnabledGenresChange,
  settingsLoaded,
  useGenres,
  useMultipleByGenre,
  settingsKey,
  title,
  description,
}: GenreCarouselTabProps) {
  const { genres, loading } = useGenres(tmdbApiKey);
  const updateStoreSettings = useUpdateSettings();

  const allGenreIds = useMemo(() => genres.map(g => g.id), [genres]);
  const genreData = useMultipleByGenre(tmdbApiKey, allGenreIds);

  const countsLoading = Array.from(genreData.values()).some(d => d.loading);

  const hasContent = (genreId: number) => {
    const data = genreData.get(genreId);
    return data ? data.items.length > 0 : false;
  };

  const availableGenreIds = useMemo(() =>
    genres.filter(g => hasContent(g.id)).map(g => g.id),
    [genres, genreData]
  );

  useEffect(() => {
    if (enabledGenres === undefined && genres.length > 0 && !countsLoading && availableGenreIds.length > 0) {
      onEnabledGenresChange(availableGenreIds);
    }
  }, [genres, enabledGenres, onEnabledGenresChange, availableGenreIds, countsLoading]);

  const isAllSelected = enabledGenres && availableGenreIds.length > 0 &&
    availableGenreIds.every(id => enabledGenres.includes(id));
  const isNoneSelected = !enabledGenres || enabledGenres.length === 0;

  function handleToggleGenre(genreId: number) {
    if (!hasContent(genreId)) return;
    const current = enabledGenres || [];
    const newEnabled = current.includes(genreId)
      ? current.filter(id => id !== genreId)
      : [...current, genreId];
    onEnabledGenresChange(newEnabled);
    saveToStorage(newEnabled);
  }

  function handleSelectAll() {
    onEnabledGenresChange(availableGenreIds);
    saveToStorage(availableGenreIds);
  }

  function handleDeselectAll() {
    onEnabledGenresChange([]);
    saveToStorage([]);
  }

  async function saveToStorage(genreIds: number[]) {
    updateStoreSettings({ [settingsKey]: genreIds });
    if (!window.storage) return;
    await window.storage.updateSettings({ [settingsKey]: genreIds });
  }

  return (
    <div className="settings-tab-content">
      <div className="settings-section">
        <div className="section-header">
          <h3>{title}</h3>
        </div>

        <p className="section-description">
          {description}
        </p>

        {!settingsLoaded || loading || countsLoading ? (
          <div className="loading-state">Loading genres...</div>
        ) : genres.length === 0 ? (
          <div className="empty-state">
            <p>No genres available</p>
            <p className="hint">Unable to load genres from cache</p>
          </div>
        ) : (
          <>
            <div className="genre-actions">
              <button
                type="button"
                className="sync-btn"
                onClick={handleSelectAll}
                disabled={isAllSelected}
              >
                Select All
              </button>
              <button
                type="button"
                className="sync-btn"
                onClick={handleDeselectAll}
                disabled={isNoneSelected}
              >
                Deselect All
              </button>
              <span className="genre-count">
                {enabledGenres?.length || 0} of {availableGenreIds.length} selected
              </span>
            </div>

            <div className="genre-grid-container">
              <div className="genre-grid">
                {genres.map(genre => {
                  const available = hasContent(genre.id);
                  return (
                    <label
                      key={genre.id}
                      className={`genre-checkbox ${!available ? 'genre-checkbox--disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={available && (enabledGenres?.includes(genre.id) ?? true)}
                        onChange={() => handleToggleGenre(genre.id)}
                        disabled={!available}
                      />
                      <span className="genre-name">{genre.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {!tmdbApiKey && (
              <p className="settings-disclaimer">
                Add a TMDB access token for more genre options.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
