import { useEffect, useState } from 'react';
import { useUIStore, useUpdateSettings } from '../../stores/uiStore';
import { useRewindStore } from '../../stores/rewindStore';
import { useSubtitleSettings } from '../../hooks/useSubtitleSettings';
import { saveSettings } from '../../utils/saveSettings';
import { estimateText, presetsUnderCap, stepCustomGb, REWIND_PRESETS } from '../../utils/rewindModel';
import { OnOff, OptionRow, Section, Segmented, SettingsTab, TextField } from './ui';

const GIB = 1024 ** 3;

/** Live TV playback: rewind and live captions. */
export function LivePlaybackTab() {
  const updateSettings = useUpdateSettings();
  const bytes = useUIStore((s) => s.settings.rewindLiveBytes) ?? 0;
  const channelRate = useRewindStore((s) => s.state?.bytesPerSecond);
  const { subtitles, updateSubtitles } = useSubtitleSettings();
  // The largest size this computer allows (main computes it and clamps to it when saving); null while asking.
  const [capBytes, setCapBytes] = useState<number | null>(null);
  useEffect(() => {
    window.platform?.rewindCapBytes().then(setCapBytes, () => setCapBytes(0));
  }, []);

  const isPreset = REWIND_PRESETS.some((p) => p.bytes === bytes);
  const [customMode, setCustomMode] = useState(bytes > 0 && !isPreset);
  const choice = bytes === 0 ? 'off' : customMode || !isPreset ? 'custom' : REWIND_PRESETS.find((p) => p.bytes === bytes)!.id;
  const [draftGb, setDraftGb] = useState(String(bytes / GIB || 1));
  useEffect(() => { setDraftGb(String(bytes / GIB || 1)); }, [bytes]);

  async function setBytes(next: number) {
    updateSettings({ rewindLiveBytes: next });
    await saveSettings({ rewindLiveBytes: next });
  }

  function commitCustom() {
    const gb = draftGb.trim() === '' ? NaN : Number(draftGb);
    if (!Number.isFinite(gb) || !capBytes) { setDraftGb(String(bytes / GIB || 1)); return; }
    const stepped = stepCustomGb(gb, capBytes);
    setDraftGb(String(stepped));  // show what was saved, also when it equals what was there
    void setBytes(stepped * GIB);
  }

  return (
    <SettingsTab>
      <Section title="Live playback">
        <OptionRow
          title="Rewind live TV"
          help={capBytes === 0
            ? 'This computer does not have enough memory for rewind.'
            : bytes === 0
              ? 'Live TV can still be paused; turn this on to rewind.'
              : `${estimateText(bytes, channelRate)} Starts with the next channel; memory is used only while you watch live TV.`}
        >
          <Segmented
            compact
            value={choice}
            disabled={!capBytes}
            options={[{ id: 'off', label: 'Off' }, ...presetsUnderCap(capBytes ?? 0).map((p) => ({ id: p.id, label: p.label })), { id: 'custom', label: 'Custom' }]}
            onChange={(id) => {
              if (id === 'off') { setCustomMode(false); void setBytes(0); return; }
              if (id === 'custom') { setCustomMode(true); if (bytes === 0 && capBytes) void setBytes(Math.min(GIB, capBytes)); return; }
              setCustomMode(false);
              void setBytes(REWIND_PRESETS.find((p) => p.id === id)!.bytes);
            }}
          />
          {choice === 'custom' && !!capBytes && (
            <label className="st-rewind-custom">
              <TextField
                type="number"
                min={0.5}
                max={capBytes / GIB}
                step={0.5}
                value={draftGb}
                onChange={(e) => setDraftGb(e.target.value)}
                onBlur={commitCustom}
                onKeyDown={(e) => { if (e.key === 'Enter') commitCustom(); }}
                aria-label="Rewind size in GB"
              />
              <span>GB, up to {capBytes / GIB} GB on this computer</span>
            </label>
          )}
        </OptionRow>
        <OptionRow title="Live captions" help={subtitles.liveDefault ? 'Captions start on for every channel that carries them.' : 'Channels start without captions.'}>
          <OnOff value={subtitles.liveDefault} onChange={(v) => void updateSubtitles({ liveDefault: v })} />
        </OptionRow>
      </Section>
    </SettingsTab>
  );
}
