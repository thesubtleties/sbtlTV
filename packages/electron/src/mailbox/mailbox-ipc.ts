/**
 * Settings > Sync & transfer: Send to a device / Show my code. The decrypted setup never goes to
 * the page; the page sees states, words and the preview. Logs event names only.
 * Bundled by esbuild (scripts/bundle-data.mjs) because it imports @sbtltv/mailbox (TypeScript).
 * Plain `tsc` also writes dist/mailbox/mailbox-ipc.js, which won't run (it imports the package's
 * TypeScript): `pnpm build` / `pnpm test` replace it with the bundle; a bare `tsc` run needs
 * `node scripts/bundle-data.mjs` after it.
 */
import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { KeyringUnavailable, Receiver, Sender, type ReceiveState, type SendState } from '@sbtltv/mailbox/client';
import { relayTransport } from './relay-transport.js';
import { ExportProblem, buildBody } from '../setup-transfer.js';
import { fitsInDrop, packJoin, packSetup, sendBody, unpackDrop, type JoinPayload, type SendSelection } from '../setup-send.js';
import { validateSetupBody, type SetupBody, type SetupPreview, type UserLists } from '../setup-body.js';
import { EFF_WORDS } from '../eff-wordlist.js';

export { MAILBOX_BASE } from './relay-transport.js';

/** What the page may see of a state: never the received payload; plus how long the current proof may take. */
function view(s: ReceiveState | SendState | null | undefined, workUpTo: number) {
  if (!s) return null;
  if (s.step === 'received') return { step: 'received' };
  if (s.step === 'starting' || s.step === 'ringing' || s.step === 'sending') return { ...s, workUpTo };
  return s;
}

/** Returns stop() (cancels a knock in progress: quit, window closed, page reloaded) and active(). */
export function registerMailbox(deps: {
  stage(body: SetupBody): { token: string; preview: SetupPreview };
  log: (m: string) => void;
  /** Sync: "Add a computer" sends a join instead of a setup; a received join waits for Join */
  sync: { joinPayload(): Promise<JoinPayload>; giverSent(): void; activateJoin(j: JoinPayload, name: string): Promise<void> };
}): { stop(): Promise<void>; active(): boolean } {
  let workUpTo = 0;
  const transport = () => relayTransport({ onWorkSeconds: (sec) => { workUpTo = sec; } });
  let role: 'receive' | 'send' | null = null;
  let receiver: Receiver | null = null;
  let sender: Sender | null = null;
  let pending: Buffer | null = null;
  let staged: { token: string; preview: SetupPreview } | undefined;
  /** A received join to someone's sync, waiting for this person to tap Join (nothing applied before) */
  let stagedJoin: JoinPayload | undefined;

  // Every start and cancel takes a new number: a start that finishes after a later cancel stands down
  let generation = 0;

  const stopAll = async () => {
    const r = receiver, s = sender;
    receiver = null; sender = null; pending = null; staged = undefined; stagedJoin = undefined; role = null; workUpTo = 0;
    await r?.cancel(); await s?.cancel();
  };

  ipcMain.handle('mailbox:receive', async () => {
    const mine = ++generation;
    await stopAll();
    if (mine !== generation) return { success: false };
    role = 'receive';
    let body: SetupBody | null = null;
    let joinIn: JoinPayload | null = null;
    const r = new Receiver(transport(), EFF_WORDS, (s: ReceiveState) => {
      if (r !== receiver) return;   // an older knock finishing after a restart
      if (s.step === 'received' && joinIn) {
        stagedJoin = joinIn;
        joinIn = null;
        deps.log('Relay: join received');
      } else if (s.step === 'received' && body) {
        staged = deps.stage(body);
        body = null;
        deps.log('Relay: setup received');
      } else if (s.step === 'failed') {
        deps.log(`Relay: receive ended (${s.reason})`);
      }
    }, {
      // Usable = a valid setup within the size limit; the giver hears "received" only then
      accept: (payload) => {
        try {
          const d = unpackDrop(payload);
          if (d.kind === 'join') joinIn = d.join; else body = d.body;
          return true;
        } catch { deps.log('Relay: received setup was not valid'); return false; }
      },
    });
    receiver = r;
    void r.start();
    return { success: true };
  });

  ipcMain.handle('mailbox:send', async (_e, sel: SendSelection & { lists?: UserLists; playlists?: Record<string, string> }, code: string) => {
    const mine = ++generation;
    try {
      await stopAll();
      if (mine !== generation) return { success: false };
      role = 'send';
      const own = buildBody(sel.parts, sel.lists ?? {}, sel.playlists ?? {}, Array.isArray(sel.sourceIds) ? sel.sourceIds.map(String) : null);
      const body = validateSetupBody(sendBody(own, sel, randomUUID));
      pending = packSetup(body);
      if (!fitsInDrop(pending)) {
        pending = null; role = null;
        return { error: 'Too big to send. Use Export to file instead.' };
      }
      const s = new Sender(transport(), EFF_WORDS, (st: SendState) => {
        if (s !== sender) return;
        if (st.step === 'received') deps.log('Relay: send picked up');
        else if (st.step === 'failed') deps.log(`Relay: send ended (${st.reason})`);
      });
      sender = s;
      void s.ring(String(code));
      return { success: true };
    } catch (error) {
      role = null;
      // The log gets field names only, never values (same rule as Export); the person gets the reason
      if (error instanceof ExportProblem) {
        deps.log(`Relay: send not started (${error.detail})`);
        return { error: error.message };
      }
      const msg = error instanceof Error ? error.message : '';
      if (msg.startsWith('invalid: extra source login')) {
        deps.log('Relay: send not started (extra source login)');
        return { error: 'An Xtream provider needs its username and password.' };
      }
      deps.log(`Relay: send not started (${msg.startsWith('invalid') ? msg.replace(/\(.*\)/, '').slice(0, 80) : error instanceof Error ? error.name : 'unknown'})`);
      return { error: msg.startsWith('invalid') ? "This setup can't be sent: something in it is too large or not allowed." : "Couldn't prepare the setup. Restart sbtlTV and try again." };
    }
  });

ipcMain.handle('mailbox:sendJoin', async (_e, code: string) => {
  const mine = ++generation;
  try {
    await stopAll();
    if (mine !== generation) return { success: false };
    role = 'send';
    pending = packJoin(await deps.sync.joinPayload());
    const s = new Sender(transport(), EFF_WORDS, (st: SendState) => {
      if (s !== sender) return;
      if (st.step === 'received') { deps.log('Relay: join picked up'); deps.sync.giverSent(); }
      else if (st.step === 'failed') deps.log(`Relay: join ended (${st.reason})`);
    });
    sender = s;
    void s.ring(String(code));
    return { success: true };
  } catch (e) {
    role = null;
    if (e instanceof KeyringUnavailable) return { error: 'Sync needs a working keyring on this computer.' };
    deps.log('Relay: join not started');
    return { error: "Couldn't start. Restart sbtlTV and try again." };
  }
});

ipcMain.handle('mailbox:join', async (_e, name: unknown) => {
  const j = stagedJoin;
  if (!j) return { error: 'Start again.' };
  stagedJoin = undefined;
  try { await deps.sync.activateJoin(j, typeof name === 'string' ? name : ''); return { success: true }; }
  catch (e) { return { error: e instanceof KeyringUnavailable ? 'Sync needs a working keyring on this computer.' : "Couldn't reach the sbtlTV relay. Try again." }; }
});

  ipcMain.handle('mailbox:confirm', async () => {
    if (!sender || !pending) return { error: 'Start again.' };
    const payload = pending;
    pending = null;  // the plaintext doesn't stay in memory longer than needed
    void sender.confirm(payload);
    return { success: true };
  });

  // The receiver's person saw the same words: only now is the drop fetched and opened
  ipcMain.handle('mailbox:sameWords', () => { receiver?.confirmWords(); return { success: true }; });

  ipcMain.handle('mailbox:cancel', async () => { generation++; await stopAll(); return { success: true }; });

  ipcMain.handle('mailbox:state', () => {
    const state = role === 'receive' ? view(receiver?.state, workUpTo) : role === 'send' ? view(sender?.state, workUpTo) : null;
    return { success: true, data: { role, state, staged, join: stagedJoin ? { computers: stagedJoin.computers.map((c) => c.name) } : undefined } };
  });

  // Quitting waits for a stop already under way (closing the window starts one), so the other side hears "cancelled"
  let stopping: Promise<void> | null = null;
  const stop = () => {
    if (role !== null || !stopping) {
      generation++;
      stopping = stopAll().finally(() => { stopping = null; });
    }
    return stopping ?? Promise.resolve();
  };
  return { stop, active: () => role !== null || stopping !== null };
}
