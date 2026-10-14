import { useState } from 'react';
import { validateAccessToken } from '../../services/tmdb';
import { useUpdateSettings } from '../../stores/uiStore';
import { Hint, KeyField, OptionRow, Section, SettingsTab } from './ui';

interface TmdbTabProps {
  tmdbApiKey: string;
  tmdbKeyValid: boolean | null;
  onApiKeyChange: (key: string) => void;
  onApiKeyValidChange: (valid: boolean | null) => void;
}

export function TmdbTab({
  tmdbApiKey,
  tmdbKeyValid,
  onApiKeyChange,
  onApiKeyValidChange,
}: TmdbTabProps) {
  const [tmdbValidating, setTmdbValidating] = useState(false);
  const updateSettings = useUpdateSettings();

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
    <SettingsTab>
      <Section
        title="TMDB"
        description="Basic TMDB data works without setup. An access token adds more: cast and director on detail pages, live genre rows, and filling in metadata your provider leaves out."
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
        <Hint>This product uses the TMDB API but is not endorsed or certified by TMDB.</Hint>
      </Section>
    </SettingsTab>
  );
}
