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
  // Never saved: main starts every launch with labels.
  const [includeAddresses, setIncludeAddresses] = useState(false);
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
    window.debug?.getIncludeAddresses?.().then(setIncludeAddresses).catch(() => {});
  }, []);

  async function handleDebugLoggingChange(enabled: boolean) {
    onDebugLoggingChange(enabled);
    updateSettings({ debugLoggingEnabled: enabled });
    if (!window.storage) return;
    await window.storage.updateSettings({ debugLoggingEnabled: enabled });
  }

  async function handleIncludeAddressesChange(on: boolean) {
    const applied = await window.debug?.setIncludeAddresses?.(on);
    setIncludeAddresses(applied ?? false);
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

        <OptionRow
          title="Provider addresses"
          help={
            <>
              Only turn this on when you're sending the log to someone you trust, privately. Never post a log made with this on publicly.
              <span className="opt-row__note">
                Your usernames and passwords are never written to the log, with this on or off. This only adds your provider's address.
              </span>
            </>
          }
        >
          <OnOff value={includeAddresses} onChange={(on) => void handleIncludeAddressesChange(on)} offLabel="Labels" onLabel="Included" />
        </OptionRow>

        {logPath && (
          <OptionRow
            title="Log file"
            help={
              <>
                Logs never contain your logins, and provider addresses appear as labels like "[source: name]" unless you include them above.
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
