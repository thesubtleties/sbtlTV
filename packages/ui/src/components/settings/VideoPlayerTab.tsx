import { useEffect, useState } from 'react';
import { useUpdateSettings } from '../../stores/uiStore';
import { debugLog } from '../../utils/debugLog';
import { OnOff, OptionRow, Section, Segmented, SettingsTab } from './ui';

type LinuxPlayerMode = 'native' | 'compatibility';

interface VideoPlayerTabProps {
  linuxPlayerMode: LinuxPlayerMode;
  onLinuxPlayerModeChange: (mode: LinuxPlayerMode) => void;
  linuxPerformanceMode: boolean;
  onLinuxPerformanceModeChange: (enabled: boolean) => void;
}

/** Linux only: which player to use and the performance-mode fallback. */
export function VideoPlayerTab({
  linuxPlayerMode,
  onLinuxPlayerModeChange,
  linuxPerformanceMode,
  onLinuxPerformanceModeChange,
}: VideoPlayerTabProps) {
  const updateSettings = useUpdateSettings();
  // The player mode is read once at launch. Ask main which player this
  // process started with so the hint can say a restart is still pending.
  const [launchedPlayerMode, setLaunchedPlayerMode] = useState<LinuxPlayerMode | null>(null);
  useEffect(() => {
    if (!window.platform?.isLinux || !window.mpv) return;
    let cancelled = false;
    window.mpv.getMode().then((info) => {
      if (!cancelled) setLaunchedPlayerMode(info.launchPlayerMode ?? null);
    }).catch((err) => debugLog(`getMode failed: ${err instanceof Error ? err.message : err}`, 'settings'));
    return () => { cancelled = true; };
  }, []);
  const playerModeChanged = launchedPlayerMode !== null && linuxPlayerMode !== launchedPlayerMode;

  async function handlePerformanceModeChange(enabled: boolean) {
    onLinuxPerformanceModeChange(enabled);
    updateSettings({ linuxPerformanceMode: enabled });
    if (!window.storage) return;
    await window.storage.updateSettings({ linuxPerformanceMode: enabled });
  }

  async function handlePlayerModeChange(mode: LinuxPlayerMode) {
    onLinuxPlayerModeChange(mode);
    updateSettings({ linuxPlayerMode: mode });
    if (!window.storage) return;
    await window.storage.updateSettings({ linuxPlayerMode: mode });
  }

  return (
    <SettingsTab>
      <Section
        title="Video player"
        description="Video normally plays inside the sbtlTV window. If playback stutters or drops frames on your GPU, the compatibility player runs mpv in its own window instead, the way sbtlTV worked before 0.10."
      >
        <OptionRow
          title="Player"
          help={
            <>
              {linuxPlayerMode === 'native'
                ? 'Video plays inside the sbtlTV window.'
                : 'mpv plays in its own window, behind sbtlTV.'}{' '}
              {playerModeChanged
                ? 'Quit and reopen sbtlTV to switch players.'
                : 'A change takes effect the next time sbtlTV starts.'}
            </>
          }
        >
          <Segmented
            value={linuxPlayerMode}
            options={[{ id: 'native', label: 'In-window' }, { id: 'compatibility', label: 'Compatibility' }]}
            onChange={(mode) => void handlePlayerModeChange(mode)}
          />
        </OptionRow>

        <OptionRow
          title="Performance mode"
          help={linuxPerformanceMode
            ? 'Simpler video scaling, and no blur behind the guide and controls. The blur changes right away; the video settings apply after you quit and reopen sbtlTV.'
            : 'Only if the in-window player drops frames at normal quality.'}
        >
          <OnOff value={linuxPerformanceMode} onChange={(enabled) => void handlePerformanceModeChange(enabled)} />
        </OptionRow>
      </Section>
    </SettingsTab>
  );
}
