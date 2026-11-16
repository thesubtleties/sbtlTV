import { useEffect, useRef, useState } from 'react';
import type { MailboxSendSource, SetupPart } from '../../types/electron';
import { useUIStore } from '../../stores/uiStore';
import { readLists } from '../../services/setup/lists';
import { rebuildFilePlaylists } from '../../services/setup/filePlaylists';
import { knockLine, type KnockState } from '../../utils/knockView';
import { KnockWords } from './KnockWords';
import { Button, Hint, OnOff, OptionRow, TextField } from './ui';

type TheirKeys = { tmdb: string; posterDb: string; subdl: string };
const NO_DRAFT: MailboxSendSource = { name: '', type: 'xtream', url: '' };

/**
 * Send to a device: pick what goes (yours, or entered just for this send and never saved here),
 * type their code, check the words, send. Leaving the panel cancels a send in progress.
 */
export function SendSetupPanel({ onClose }: { onClose: () => void }) {
  const sources = useUIStore((s) => s.sources);
  const [picked, setPicked] = useState<string[]>(() => sources.map((s) => s.id));
  const [logins, setLogins] = useState(true);
  const [settings, setSettings] = useState(false);
  const [myKeys, setMyKeys] = useState(false);
  const [extras, setExtras] = useState<MailboxSendSource[]>([]);
  const [draft, setDraft] = useState<MailboxSendSource | null>(null);
  const [theirKeys, setTheirKeys] = useState<TheirKeys>({ tmdb: '', posterDb: '', subdl: '' });
  const [code, setCode] = useState('');
  const [state, setState] = useState<KnockState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped on every action: a poll answered after it describes the old knock and is dropped
  const gen = useRef(0);
  const started = useRef(false);

  useEffect(() => {
    const id = window.setInterval(async () => {
      const asked = gen.current;
      const r = await window.mailbox?.state();
      if (asked !== gen.current) return;
      if (r?.data.role === 'send' && r.data.state) setState(r.data.state);
    }, 500);
    // Cancels only a send this panel started (the Receive panel may own the mailbox)
    return () => { window.clearInterval(id); if (started.current) void window.mailbox?.cancel(); };
  }, []);

  const nothing = picked.length === 0 && extras.length === 0 && !settings && !myKeys && !Object.values(theirKeys).some(Boolean);

  async function knock() {
    if (!window.mailbox || busy) return;
    gen.current++;
    started.current = true;
    setBusy(true);
    setError(null);
    const parts: SetupPart[] = [
      ...(picked.length ? ['sources' as const] : []),
      ...(picked.length && logins ? ['logins' as const] : []),
      ...(settings ? ['settings' as const] : []),
      ...(myKeys ? ['apiKeys' as const] : []),
    ];
    try {
      const lists = await readLists([], settings);
      const playlists = picked.length ? await rebuildFilePlaylists(sources.filter((s) => picked.includes(s.id))) : {};
      const apiKeys = Object.fromEntries(Object.entries(theirKeys).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
      const r = await window.mailbox.send({ parts, sourceIds: picked, extras: { sources: extras, apiKeys }, lists, playlists }, code);
      if (r.error) setError(r.error); else setState({ step: 'ringing' });
    } catch {
      setError("Couldn't prepare the setup. Restart sbtlTV and try again.");
    } finally {
      setBusy(false);
    }
  }

  // Keeps the typed code after "isn't valid" so it can be checked and fixed
  const again = () => { gen.current++; void window.mailbox?.cancel(); setState(null); };

  if (state) {
    const line = knockLine('send', state);
    return (
      <div className="knock-panel">
        {state.step === 'words' && <KnockWords words={state.words} />}
        <div aria-live="polite"><Hint tone={line.tone === 'error' ? 'danger' : line.tone === 'ok' ? 'ok' : undefined}>{line.text}</Hint></div>
        <div className="knock-panel__actions">
          {state.step === 'words' && <Button variant="primary" onClick={() => void window.mailbox?.confirm()}>Words match, send</Button>}
          {(state.step === 'ringing' || state.step === 'words' || state.step === 'sending' || state.step === 'sent') && <Button onClick={again}>Cancel</Button>}
          {line.canRetry && <Button onClick={again}>Start again</Button>}
          {state.step === 'received' && <Button onClick={onClose}>Done</Button>}
        </div>
      </div>
    );
  }

  return (
    <div className="knock-panel">
      {sources.map((s) => (
        <OptionRow key={s.id} title={s.name}>
          <OnOff value={picked.includes(s.id)} onChange={(on) => setPicked(on ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
        </OptionRow>
      ))}
      {sources.length > 0 && (
        <OptionRow title="With logins" help="Xtream passwords. M3U logins are part of their addresses.">
          <OnOff value={logins} onChange={setLogins} disabled={picked.length === 0} />
        </OptionRow>
      )}
      {extras.map((s, i) => (
        <OptionRow key={`extra-${i}`} title={s.name} help="Just for this send. Not saved here.">
          <Button onClick={() => setExtras(extras.filter((_, j) => j !== i))}>Remove</Button>
        </OptionRow>
      ))}
      {draft ? (
        <form className="knock-draft" onSubmit={(e) => { e.preventDefault(); setExtras([...extras, draft]); setDraft(null); }}>
          <TextField autoFocus aria-label="Name" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <select className="st-select" aria-label="Type" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as 'xtream' | 'm3u' })}>
            <option value="xtream">Xtream</option>
            <option value="m3u">M3U playlist</option>
          </select>
          <TextField aria-label="Address" placeholder="http://…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          {draft.type === 'xtream' && (
            <>
              <TextField aria-label="Username" placeholder="Username" autoComplete="off" value={draft.username ?? ''} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
              <TextField aria-label="Password" type="password" placeholder="Password" autoComplete="off" value={draft.password ?? ''} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
            </>
          )}
          <div className="knock-panel__actions">
            <Button type="submit" variant="primary" disabled={!draft.name.trim() || !/^https?:\/\/\S+$/i.test(draft.url.trim()) || (draft.type === 'xtream' && (!draft.username?.trim() || !draft.password?.trim()))}>Add</Button>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div><Button onClick={() => setDraft(NO_DRAFT)}>Add a provider just for this send</Button></div>
      )}
      <OptionRow title="Your settings" help="Look, subtitles and players."><OnOff value={settings} onChange={setSettings} /></OptionRow>
      <OptionRow title="Your API keys" help="TMDB, RatingPosterDB and SubDL. They'd use your account and quota."><OnOff value={myKeys} onChange={setMyKeys} /></OptionRow>
      <OptionRow title="Keys for them" help="Ones you made for them. Sent, not saved here.">
        <div className="knock-draft">
          <TextField aria-label="TMDB key for them" placeholder="TMDB" autoComplete="off" value={theirKeys.tmdb} onChange={(e) => setTheirKeys({ ...theirKeys, tmdb: e.target.value })} />
          <TextField aria-label="SubDL key for them" placeholder="SubDL" autoComplete="off" value={theirKeys.subdl} onChange={(e) => setTheirKeys({ ...theirKeys, subdl: e.target.value })} />
          <TextField aria-label="RatingPosterDB key for them" placeholder="RatingPosterDB" autoComplete="off" value={theirKeys.posterDb} onChange={(e) => setTheirKeys({ ...theirKeys, posterDb: e.target.value })} />
        </div>
      </OptionRow>
      <OptionRow title="Their code" help="On their computer: Live TV › Receive a setup, or Settings › Sync & transfer › Show my code.">
        <form onSubmit={(e) => { e.preventDefault(); if (!busy && !nothing && code.replace(/[\s-]/g, '').length === 8) void knock(); }}>
          <TextField aria-label="Their code" placeholder="XXXX-XXXX" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
        </form>
      </OptionRow>
      {error && <Hint tone="danger">{error}</Hint>}
      <div className="knock-panel__actions">
        <Button variant="primary" disabled={busy || nothing || code.replace(/[\s-]/g, '').length !== 8} onClick={() => void knock()}>{busy ? 'Connecting…' : 'Connect'}</Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
