import { useState, useEffect } from 'react';
import { useUpdateSettings } from '../../stores/uiStore';
import { Button, OnOff, OptionRow, Section, SettingsTab } from './ui';

interface DebugTabProps {
  debugLoggingEnabled: boolean;
  onDebugLoggingChange: (enabled: boolean) => void;
}

export function DebugTab({
  debugLoggingEnabled,
  onDebugLoggingChange,
}: DebugTabProps) {
  const [logPath, setLogPath] = useState<string>('');
  const updateSettings = useUpdateSettings();

  useEffect(() => {
    // Get log file path on mount
    if (window.debug) {
      window.debug.getLogPath().then((result) => {
        if (result.data) {
          setLogPath(result.data);
        }
      });
    }
  }, []);

  async function handleDebugLoggingChange(enabled: boolean) {
    onDebugLoggingChange(enabled);
    updateSettings({ debugLoggingEnabled: enabled });
    if (!window.storage) return;
    await window.storage.updateSettings({ debugLoggingEnabled: enabled });
  }

  async function handleOpenLogFolder() {
    if (window.debug) {
      await window.debug.openLogFolder();
    }
  }



  return (
    <SettingsTab>
      <Section
        title="Debug logging"
        description="Verbose logs help diagnose video playback, network and application problems. They are written to a file you can share when reporting a bug."
      >
        <OptionRow
          title="Logging"
          help={debugLoggingEnabled
            ? 'Detailed logs from mpv, the window and the main process are being written. This may slightly affect performance.'
            : 'Only basic logging. Turn this on before reproducing a problem you want to report.'}
        >
          <OnOff value={debugLoggingEnabled} onChange={(enabled) => void handleDebugLoggingChange(enabled)} />
        </OptionRow>

        {logPath && (
          <OptionRow
            title="Log file"
            help={
              <>
                Logs can contain stream addresses, so only share them with people you trust.
                Report issues on{' '}
                <a href="https://github.com/thesubtleties/sbtlTV/issues" target="_blank" rel="noopener noreferrer">GitHub</a>.
              </>
            }
          >
            <code className="st-code">{logPath}</code>
            <Button onClick={() => void handleOpenLogFolder()}>Open folder</Button>
          </OptionRow>
        )}
      </Section>
    </SettingsTab>
  );
}
