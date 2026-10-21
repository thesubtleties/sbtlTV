import { useEffect, useState } from 'react';
import { useSubtitleSettings } from '../../hooks/useSubtitleSettings';
import { useUpdateSettings } from '../../stores/uiStore';
import type { SubdlUsageInfo } from '../../types/electron';
import { KeyField, OnOff, OptionRow, Section, Segmented, SettingsTab } from './ui';

interface SubtitlesTabProps {
  subdlApiKey: string;
  subdlKeyValid: boolean | null;
  onSubdlKeyChange: (key: string) => void;
  onSubdlKeyValidChange: (valid: boolean | null) => void;
}

/** Movie and series subtitles, and SubDL for files without any. Language and look are in Video Player; live captions in Live playback. */
export function SubtitlesTab({ subdlApiKey, subdlKeyValid, onSubdlKeyChange, onSubdlKeyValidChange }: SubtitlesTabProps) {
  const { subtitles, updateSubtitles } = useSubtitleSettings();
  const updateSettings = useUpdateSettings();
  const [checking, setChecking] = useState(false);
  const [usage, setUsage] = useState<SubdlUsageInfo | null>(null);
  const keySet = subdlApiKey.trim().length > 0 && subdlKeyValid === true;

  useEffect(() => {
    if (!keySet) { setUsage(null); return; }
    let alive = true;
    void window.subdl?.usage().then((r) => { if (alive) setUsage(r.usage ?? null); });
    return () => { alive = false; };
  }, [keySet]);

  async function saveKey() {
    setChecking(true);
    onSubdlKeyValidChange(null);
    const key = subdlApiKey.trim();
    const checked = key ? await window.subdl?.checkKey(key) : undefined;
    const ok = !key || !!checked?.usage;
    onSubdlKeyValidChange(ok);
    if (ok) {
      updateSettings({ subdlApiKey: key });
      await window.storage?.updateSettings({ subdlApiKey: key });
      setUsage(checked?.usage ?? null);
    }
    setChecking(false);
  }

  return (
    <SettingsTab>
      <Section
        title="Subtitles"
        description="Subtitles on movies and series, where the file has them. The CC button in the player bar (or V) turns them on or off until you quit sbtlTV; right-click it for tracks and timing. Language and look are under Video Player."
      >
        <OptionRow title="Movie & series subtitles" help={subtitles.vodDefault ? 'Subtitles start on, in your chosen language when the file has it.' : 'Movies and episodes start without subtitles.'}>
          <OnOff value={subtitles.vodDefault} onChange={(v) => void updateSubtitles({ vodDefault: v })} />
        </OptionRow>
      </Section>
      <Section
        title="SubDL"
        description={<>Free key from subdl.com. Finds subtitles for movies and series that have none in your language. <a href="https://subdl.com/panel/api" target="_blank" rel="noopener noreferrer">Get a key</a></>}
      >
        <OptionRow title="API key" help={usage ? `${usage.downloadsLeft} of ${usage.downloadsLimit} downloads left today` : undefined}>
          <KeyField
            label="SubDL API key"
            value={subdlApiKey}
            placeholder="SubDL API key"
            validating={checking}
            valid={subdlKeyValid}
            onChange={(key) => { onSubdlKeyChange(key); onSubdlKeyValidChange(null); }}
            onSave={() => void saveKey()}
          />
        </OptionRow>
        {keySet && (
          <OptionRow title="Prefer" help="SDH adds sound cues like [door slams].">
            <Segmented
              value={subtitles.preferSdh ? 'sdh' : 'standard'}
              options={[{ id: 'standard', label: 'Standard' }, { id: 'sdh', label: 'SDH' }]}
              onChange={(v) => void updateSubtitles({ preferSdh: v === 'sdh' })}
            />
          </OptionRow>
        )}
      </Section>
    </SettingsTab>
  );
}
