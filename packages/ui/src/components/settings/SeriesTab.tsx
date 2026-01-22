import { useEffect } from 'react';
import { useTvGenres } from '../../hooks/useTmdbLists';

interface SeriesTabProps {
  tmdbApiKey: string | null;
  enabledGenres: number[] | undefined;
  onEnabledGenresChange: (genres: number[]) => void;
}

export function SeriesTab({
  tmdbApiKey,
  enabledGenres,
  onEnabledGenresChange,
}: SeriesTabProps) {
  const { genres, loading } = useTvGenres(tmdbApiKey);

  // Initialize with all genres enabled if undefined
  useEffect(() => {
    if (enabledGenres === undefined && genres.length > 0) {
      onEnabledGenresChange(genres.map(g => g.id));
    }
  }, [genres, enabledGenres, onEnabledGenresChange]);

  const isAllSelected = enabledGenres && genres.length > 0 && enabledGenres.length === genres.length;
  const isNoneSelected = !enabledGenres || enabledGenres.length === 0;

  function handleToggleGenre(genreId: number) {
    const current = enabledGenres || [];
    const newEnabled = current.includes(genreId)
      ? current.filter(id => id !== genreId)
      : [...current, genreId];
    onEnabledGenresChange(newEnabled);
    saveToStorage(newEnabled);
  }

  function handleSelectAll() {
    const allIds = genres.map(g => g.id);
    onEnabledGenresChange(allIds);
    saveToStorage(allIds);
  }

  function handleDeselectAll() {
    onEnabledGenresChange([]);
    saveToStorage([]);
  }

  async function saveToStorage(genreIds: number[]) {
    if (!window.storage) return;
    await window.storage.updateSettings({ seriesGenresEnabled: genreIds });
  }

  if (!tmdbApiKey) {
    return (
      <div className="settings-tab-content">
        <div className="settings-section">
          <div className="section-header">
            <h3>Series Genre Carousels</h3>
          </div>
          <div className="empty-state">
            <p>TMDB API key required</p>
            <p className="hint">Add a TMDB API key in the TMDB tab to configure genre carousels</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-tab-content">
      <div className="settings-section">
        <div className="section-header">
          <h3>Series Genre Carousels</h3>
        </div>

        <p className="section-description">
          Select which genres to show as carousels on the Series home page.
          Each selected genre will appear as a Netflix-style row.
        </p>

        {loading ? (
          <div className="loading-state">Loading genres...</div>
        ) : genres.length === 0 ? (
          <div className="empty-state">
            <p>No genres available</p>
            <p className="hint">Check your TMDB API key configuration</p>
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
                {enabledGenres?.length || 0} of {genres.length} selected
              </span>
            </div>

            <div className="genre-grid-container">
              <div className="genre-grid">
                {genres.map(genre => (
                  <label key={genre.id} className="genre-checkbox">
                    <input
                      type="checkbox"
                      checked={enabledGenres?.includes(genre.id) ?? true}
                      onChange={() => handleToggleGenre(genre.id)}
                    />
                    <span className="genre-name">{genre.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
