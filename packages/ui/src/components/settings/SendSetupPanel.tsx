import { useState } from 'react';
import type { MailboxSendSource, SetupPart } from '../../types/electron';
import { useUIStore } from '../../stores/uiStore';
import { readLists } from '../../services/setup/lists';
import { rebuildFilePlaylists } from '../../services/setup/filePlaylists';
import { KnockSendView, useKnockSend } from './useKnockSend';
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
  const { state, error, busy, begin, again } = useKnockSend();

  const nothing = picked.length === 0 && extras.length === 0 && !settings && !myKeys && !Object.values(theirKeys).some(Boolean);

  function knock() {
    const parts: SetupPart[] = [
      ...(picked.length ? ['sources' as const] : []),
      ...(picked.length && logins ? ['logins' as const] : []),
      ...(settings ? ['settings' as const] : []),
      ...(myKeys ? ['apiKeys' as const] : []),
    ];
    return begin(async () => {
      const lists = await readLists([], settings);
      const playlists = picked.length ? await rebuildFilePlaylists(sources.filter((s) => picked.includes(s.id))) : {};
      const apiKeys = Object.fromEntries(Object.entries(theirKeys).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
      return window.mailbox!.send({ parts, sourceIds: picked, extras: { sources: extras, apiKeys }, lists, playlists }, code);
    }, "Couldn't prepare the setup. Restart sbtlTV and try again.");
  }

  if (state) return <KnockSendView role="send" state={state} confirmLabel="Words match, send" onAgain={again} onDone={onClose} />;

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
        <OptionRow title="Provider for them" help="Just for this send. Not saved here.">
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
        </OptionRow>
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
