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
        description="Detailed logs for tracking down playback, network and app problems."
      >
        <OptionRow
          title="Logging"
          help={debugLoggingEnabled
            ? 'Writing detailed logs. Can slow things down slightly.'
            : 'Turn on, then make the problem happen again.'}
        >
          <OnOff value={debugLoggingEnabled} onChange={(enabled) => void handleDebugLoggingChange(enabled)} />
        </OptionRow>

        <OptionRow
          title="Provider addresses in the debug log"
          help={
            <>
              Adds your provider's address to the log. Only for a log you send privately. Logins are never logged either way.
              {legend.length > 0 && (
                <span className="opt-row__note">
                  In the log: {legend.map(({ n, name }) => `source ${n} = ${name}`).join(', ')}.
                </span>
              )}
            </>
          }
        >
          <OnOff value={includeAddresses} onChange={(on) => void handleIncludeAddressesChange(on)} offLabel="Hidden" onLabel="Included" />
        </OptionRow>

        {logPath && (
          <OptionRow title="Log file">
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
      description="Everything needed to look into a problem, in one zip. No logins, addresses or names. Nothing is sent; you attach it."
    >
      {!loggingOn && <Hint>Turn on debug logging, make the problem happen again, then save the report.</Hint>}
      {addressesIncluded && <Hint tone="warn">Addresses are being logged right now. The zip leaves them out.</Hint>}
      <div className="st-actions">
        <Button onClick={() => void togglePreview()} disabled={state.kind === 'loading'} aria-expanded={preview !== null}>
          {state.kind === 'loading' ? 'Putting it together…' : preview === null ? "What's in it" : 'Hide'}
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={state.kind === 'busy' || state.kind === 'loading'}>{state.kind === 'busy' ? 'Saving…' : 'Save report file…'}</Button>
        <a className="st-btn st-btn--default" href={issueUrl(version, platform)} target="_blank" rel="noopener noreferrer">Open a GitHub issue</a>
      </div>
      {state.kind === 'saved' && <Hint tone="ok">Saved. Drag it into a new issue.</Hint>}
      {state.kind === 'error' && <Hint tone="danger">{state.message}</Hint>}
      {preview !== null && (
        <>
          <Hint>This is report.json. The zip also has the log, cleaned the same way.</Hint>
          <pre className="st-report-preview">{preview}</pre>
        </>
      )}
    </Section>
  );
}
