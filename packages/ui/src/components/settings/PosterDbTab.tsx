import { useState } from 'react';
import { validateRpdbApiKey, getRpdbTier, rpdbSupportsBackdrops } from '../../services/rpdb';
import { useUpdateSettings } from '../../stores/uiStore';
import { KeyField, OnOff, OptionRow, Section, SettingsTab } from './ui';

interface PosterDbTabProps {
  apiKey: string;
  apiKeyValid: boolean | null;
  onApiKeyChange: (key: string) => void;
  onApiKeyValidChange: (valid: boolean | null) => void;
  backdropsEnabled: boolean;
  onBackdropsEnabledChange: (enabled: boolean) => void;
}

export function PosterDbTab({
  apiKey,
  apiKeyValid,
  onApiKeyChange,
  onApiKeyValidChange,
  backdropsEnabled,
  onBackdropsEnabledChange,
}: PosterDbTabProps) {
  const [validating, setValidating] = useState(false);
  const updateSettings = useUpdateSettings();

  const tier = getRpdbTier(apiKey);
  const supportsBackdrops = rpdbSupportsBackdrops(apiKey);

  async function saveApiKey() {
    if (!window.storage) return;
    setValidating(true);
    onApiKeyValidChange(null);

    // Validate the key first
    const isValid = apiKey ? await validateRpdbApiKey(apiKey) : true;
    onApiKeyValidChange(isValid);

    if (isValid) {
      updateSettings({ posterDbApiKey: apiKey });
      await window.storage.updateSettings({ posterDbApiKey: apiKey });
    }

    setValidating(false);
  }

  async function handleBackdropsToggle(enabled: boolean) {
    onBackdropsEnabledChange(enabled);
    updateSettings({ rpdbBackdropsEnabled: enabled });
    if (!window.storage) return;
    await window.storage.updateSettings({ rpdbBackdropsEnabled: enabled });
  }

  return (
    <SettingsTab>
      <Section
        title="RatingPosterDB"
        description={
          <>
            Overlays rating badges (IMDb, Rotten Tomatoes and others) on movie and series posters.
            Choose which badges at{' '}
            <a href="https://manager.ratingposterdb.com/" target="_blank" rel="noopener noreferrer">manager.ratingposterdb.com</a>.
          </>
        }
        actions={tier && apiKeyValid ? <span className="st-pill">Tier {tier}</span> : undefined}
      >
        <OptionRow
          title="API key"
          help={
            <>
              A third-party subscription service; see{' '}
              <a href="https://ratingposterdb.com/" target="_blank" rel="noopener noreferrer">ratingposterdb.com</a>{' '}
              for pricing and features.
            </>
          }
        >
          <KeyField
            label="RatingPosterDB API key"
            value={apiKey}
            placeholder="RPDB API key"
            validating={validating}
            valid={apiKeyValid}
            onChange={(key) => { onApiKeyChange(key); onApiKeyValidChange(null); }}
            onSave={() => void saveApiKey()}
          />
        </OptionRow>

        {apiKeyValid && (
          <OptionRow
            title="Backdrops"
            help={!supportsBackdrops
              ? 'RPDB backdrops need a Tier 2 or higher subscription.'
              : backdropsEnabled
                ? 'Backdrop images come from RPDB.'
                : 'Backdrop images come from TMDB.'}
          >
            <OnOff
              value={backdropsEnabled && supportsBackdrops}
              onChange={(enabled) => void handleBackdropsToggle(enabled)}
              disabled={!supportsBackdrops}
            />
          </OptionRow>
        )}
      </Section>
    </SettingsTab>
  );
}
