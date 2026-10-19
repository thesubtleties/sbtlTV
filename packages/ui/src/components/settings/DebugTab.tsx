import './DebugTab.css';
import { useState, useEffect } from 'react';
import { useUpdateSettings } from '../../stores/uiStore';
import { Button, Hint, OnOff, OptionRow, Section, SettingsTab } from './ui';
import { data } from '../../data/client';
import { issueUrl } from '../../services/report/issueUrl';

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
  const [legend, setLegend] = useState<{ n: number; name: string }[]>([]);
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
    window.debug?.getSourceLegend?.().then(setLegend).catch(() => {});
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
          title="Provider addresses in the debug log"
          help={
            <>
              Only turn this on when you're sending the log to someone you trust, privately. Never post a log made with this on publicly.
              <span className="opt-row__note opt-row__note--strong">
                Your usernames and passwords are never written to the log, with this on or off. This only adds your provider's address.
              </span>
              {legend.length > 0 && (
                <span className="opt-row__note">
                  In the log your sources appear as {legend.map(({ n, name }) => `source ${n} (${name})`).join(', ')}; their names are not written to it.
                </span>
              )}
            </>
          }
        >
          <OnOff value={includeAddresses} onChange={(on) => void handleIncludeAddressesChange(on)} offLabel="Hidden" onLabel="Included" />
        </OptionRow>

        {logPath && (
          <OptionRow
            title="Log file"
            help={
              <>
                Logs never contain your logins, and provider addresses appear as labels like "[source 1]" or "[host 2]" unless you include them above.
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
      <BugReportSection loggingOn={debugLoggingEnabled} addressesIncluded={includeAddresses} />
    </SettingsTab>
  );
}

type ReportState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'loading' } | { kind: 'saved' } | { kind: 'error'; message: string };

/** A zip for a bug report: what it holds is shown first, the person attaches it themselves. */
function BugReportSection({ loggingOn, addressesIncluded }: { loggingOn: boolean; addressesIncluded: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<ReportState>({ kind: 'idle' });
  const [version, setVersion] = useState('');
  const platform = window.platform?.isMac ? 'darwin' : window.platform?.isWindows ? 'win32' : 'linux';

  useEffect(() => { void window.platform?.getVersion().then(setVersion).catch(() => {}); }, []);

  // null when the data process does not answer: the report then says so, not "never synced".
  const syncStatus = () => data.query({ type: 'syncStatus' }).catch(() => null);

  async function togglePreview() {
    if (preview !== null) { setPreview(null); return; }
    setState({ kind: 'loading' });
    try {
      const r = await window.debug?.reportPreview(await syncStatus());
      if (r?.data) { setPreview(r.data); setState({ kind: 'idle' }); }
      else setState({ kind: 'error', message: r?.error ?? 'The report could not be put together.' });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function save() {
    if (!window.debug) return;
    setState({ kind: 'busy' });
    try {
      const r = await window.debug.saveReport(await syncStatus());
      if (r.error) setState({ kind: 'error', message: r.error });
      else setState(r.success ? { kind: 'saved' } : { kind: 'idle' });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <Section
      title="Bug report"
      description="A zip with what's needed to look into a problem: versions, your computer's hardware, settings, how your sources are doing, and the debug log. No logins, provider addresses, source names or your user folder. Nothing is sent: you attach the file to an issue yourself."
    >
      {!loggingOn && <Hint>Turn on debug logging, make the problem happen again, then save the report.</Hint>}
      {addressesIncluded && <Hint tone="warn">Provider addresses are being written to the log file right now. The report zip never contains them; send the log file itself only to someone you trust.</Hint>}
      <div className="st-actions">
        <Button onClick={() => void togglePreview()} disabled={state.kind === 'loading'} aria-expanded={preview !== null}>
          {state.kind === 'loading' ? 'Putting it together…' : preview === null ? "What's in it" : 'Hide'}
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={state.kind === 'busy' || state.kind === 'loading'}>{state.kind === 'busy' ? 'Saving…' : 'Save report file…'}</Button>
        <a className="st-btn st-btn--default" href={issueUrl(version, platform)} target="_blank" rel="noopener noreferrer">Open a GitHub issue</a>
      </div>
      {state.kind === 'saved' && <Hint tone="ok">Saved, and its folder is open. Open a GitHub issue and drag the zip into it.</Hint>}
      {state.kind === 'error' && <Hint tone="danger">{state.message}</Hint>}
      {preview !== null && (
        <>
          <Hint>This is report.json. The zip also has the debug log, with logins, addresses, source names and your user folder taken out.</Hint>
          <pre className="st-report-preview">{preview}</pre>
        </>
      )}
    </Section>
  );
}
