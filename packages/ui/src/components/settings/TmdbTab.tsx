import { useState } from 'react';
import { validateAccessToken } from '../../services/tmdb';
import { useTmdbKeyHealth } from '../../services/tmdbKeyHealth';
import { useUpdateSettings } from '../../stores/uiStore';
import { KeyField, OptionRow, Section, SettingsTab } from './ui';
import tmdbLogo from '../../assets/tmdb-logo.svg';
import './TmdbTab.css';

interface TmdbTabProps {
  tmdbApiKey: string;
  tmdbKeyValid: boolean | null;
  onApiKeyChange: (key: string) => void;
  onApiKeyValidChange: (valid: boolean | null) => void;
}

export function TmdbTab(props: TmdbTabProps) {
  return (
    <SettingsTab>
      <TmdbKeySection {...props} />
    </SettingsTab>
  );
}

/** The TMDB token with its check and attribution; shared by Settings › TMDB and the first-run setup. */
export function TmdbKeySection({
  tmdbApiKey,
  tmdbKeyValid,
  onApiKeyChange,
  onApiKeyValidChange,
}: TmdbTabProps) {
  const [tmdbValidating, setTmdbValidating] = useState(false);
  const updateSettings = useUpdateSettings();
  const keyStopped = useTmdbKeyHealth((s) => s.stopped);

  async function saveTmdbApiKey() {
    if (!window.storage) return;
    setTmdbValidating(true);
    onApiKeyValidChange(null);

    // Validate the key first
    const isValid = tmdbApiKey ? await validateAccessToken(tmdbApiKey) : true;
    onApiKeyValidChange(isValid);

    if (isValid) {
      updateSettings({ tmdbApiKey });
      await window.storage.updateSettings({ tmdbApiKey });
    }

    setTmdbValidating(false);
  }

  return (
    <Section
      title="TMDB"
      description="Basic TMDB data works without setup. An access token adds more: cast, director and More like this on detail pages, live genre rows, and filling in metadata your provider leaves out."
    >
      <OptionRow
        title="Access token"
        help={
          <>
            Use the token labeled "API Read Access Token" in your{' '}
            <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer">TMDB API settings</a>.
            No account?{' '}
            <a href="https://www.themoviedb.org/signup" target="_blank" rel="noopener noreferrer">It's free</a>.
          </>
        }
      >
        <KeyField
          label="TMDB access token"
          value={tmdbApiKey}
          placeholder="API Read Access Token"
          validating={tmdbValidating}
          valid={tmdbKeyValid}
          onChange={(key) => { onApiKeyChange(key); onApiKeyValidChange(null); }}
          onSave={() => void saveTmdbApiKey()}
        />
      </OptionRow>
      {keyStopped && <p className="st-hint st-hint--danger">TMDB rejected this token, so TMDB requests are paused. Save a new one or restart the app to try again.</p>}
      {/* TMDB's attribution terms: their logo plus this notice */}
      <div className="tmdb-attribution">
        <img src={tmdbLogo} alt="TMDB" className="tmdb-attribution__logo" />
        <p className="st-hint">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </div>
    </Section>
  );
}
