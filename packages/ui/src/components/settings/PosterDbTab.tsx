interface PosterDbTabProps {
  apiKey: string;
  onApiKeyChange: (key: string) => void;
}

export function PosterDbTab({ apiKey, onApiKeyChange }: PosterDbTabProps) {
  return (
    <div className="settings-tab-content">
      <div className="settings-section disabled-section">
        <div className="section-header">
          <h3>RatingPosterDB Integration</h3>
          <span className="coming-soon-badge">Coming Soon</span>
        </div>

        <p className="section-description">
          RatingPosterDB provides custom rating posters that overlay TMDB posters
          with ratings from IMDb, Rotten Tomatoes, and more.
        </p>

        <div className="tmdb-form">
          <div className="form-group inline">
            <label>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="Enter your RatingPosterDB API key"
              disabled
            />
            <button type="button" disabled>
              Save
            </button>
          </div>
          <p className="form-hint disabled">
            Get an API key at{' '}
            <span className="disabled-link">ratingposterdb.com</span>
          </p>
        </div>

        <div className="feature-preview">
          <h4>Features (when available):</h4>
          <ul>
            <li>Overlay rating badges on movie/series posters</li>
            <li>Show IMDb, Rotten Tomatoes, Metacritic scores</li>
            <li>Customizable badge positions and styles</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
