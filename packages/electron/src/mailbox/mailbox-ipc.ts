/**
 * Settings > Sync & transfer: Send to a device / Show my code. The decrypted setup never goes to
 * the page; the page sees states, words and the preview. Logs event names only.
 * Bundled by esbuild (scripts/bundle-data.mjs) because it imports @sbtltv/mailbox (TypeScript).
 * Plain `tsc` also writes dist/mailbox/mailbox-ipc.js, which won't run (it imports the package's
 * TypeScript): `pnpm build` / `pnpm test` replace it with the bundle; a bare `tsc` run needs
 * `node scripts/bundle-data.mjs` after it.
 */
import { app, ipcMain, net } from 'electron';
import { randomUUID } from 'node:crypto';
import { Receiver, Sender, Transport, type ReceiveState, type SendState } from '@sbtltv/mailbox/client';
import { measurePowRate, powSecondsUpTo } from '@sbtltv/mailbox/protocol';
import { buildBody } from '../setup-transfer.js';
import { fitsInDrop, packSetup, sendBody, unpackSetup, type SendSelection } from '../setup-send.js';
import { validateSetupBody, type SetupBody, type SetupPreview, type UserLists } from '../setup-body.js';
import { EFF_WORDS } from '../eff-wordlist.js';

export const MAILBOX_BASE = 'https://mailbox.sbtltv.com';

/** What the page may see of a state: never the received payload; plus how long the current proof may take. */
function view(s: ReceiveState | SendState | null | undefined, workUpTo: number) {
  if (!s) return null;
  if (s.step === 'received') return { step: 'received' };
  if (s.step === 'starting' || s.step === 'ringing' || s.step === 'sending') return { ...s, workUpTo };
  return s;
}

/** This computer's proof speed, measured once (~30 ms) the first time it's needed. */
let powRate = 0;

/** Returns stop() (cancels a knock in progress: quit, window closed, page reloaded) and active(). */
export function registerMailbox(deps: { stage(body: SetupBody): { token: string; preview: SetupPreview }; log: (m: string) => void }): { stop(): Promise<void>; active(): boolean } {
  let workUpTo = 0;
  const transport = () => new Transport({
    base: process.env.SBTLTV_MAILBOX || MAILBOX_BASE,
    version: app.getVersion(),
    fetch: (req) => net.fetch(req, { cache: 'no-store' } as RequestInit),
    onWork: (bits) => { powRate ||= measurePowRate(); workUpTo = powSecondsUpTo(bits, powRate); },
  });
  let role: 'receive' | 'send' | null = null;
  let receiver: Receiver | null = null;
  let sender: Sender | null = null;
  let pending: Buffer | null = null;
  let staged: { token: string; preview: SetupPreview } | undefined;
  let receiveFailed = false;   // the payload arrived but wasn't a valid setup

  // Every start and cancel takes a new number: a start that finishes after a later cancel stands down
  let generation = 0;

  const stopAll = async () => {
    const r = receiver, s = sender;
    receiver = null; sender = null; pending = null; staged = undefined; role = null; receiveFailed = false; workUpTo = 0;
    await r?.cancel(); await s?.cancel();
  };

  ipcMain.handle('mailbox:receive', async () => {
    const mine = ++generation;
    await stopAll();
    if (mine !== generation) return { success: false };
    role = 'receive';
    const r = new Receiver(transport(), EFF_WORDS, (s: ReceiveState) => {
      if (r !== receiver) return;   // an older knock finishing after a restart
      if (s.step === 'received') {
        try {
          staged = deps.stage(unpackSetup(s.payload));
          deps.log('Mailbox: setup received');
        } catch {
          receiveFailed = true;
          deps.log('Mailbox: received setup was not valid');
        }
      } else if (s.step === 'failed') {
        deps.log(`Mailbox: receive ended (${s.reason})`);
      }
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
      const base = buildBody(sel.parts, sel.lists ?? {}, sel.playlists ?? {});
      const body = validateSetupBody(sendBody(base, sel, randomUUID));
      pending = packSetup(body);
      if (!fitsInDrop(pending)) {
        pending = null; role = null;
        return { error: 'Too big to send. Use Export to file instead.' };
      }
      const s = new Sender(transport(), EFF_WORDS, (st: SendState) => {
        if (s !== sender) return;
        if (st.step === 'received') deps.log('Mailbox: send picked up');
        else if (st.step === 'failed') deps.log(`Mailbox: send ended (${st.reason})`);
      });
      sender = s;
      void s.ring(String(code));
      return { success: true };
    } catch (error) {
      role = null;
      // Field names only, never values (same rule as Export)
      deps.log(`Mailbox: send not started (${error instanceof Error ? error.message.slice(0, 120) : 'unknown'})`);
      return { error: error instanceof Error && error.message.startsWith('invalid') ? "This setup can't be sent. Details are in the debug log." : "Couldn't prepare the setup. Restart sbtlTV and try again." };
    }
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
    const state = role === 'receive'
      ? (receiveFailed ? { step: 'failed', reason: 'broken' } : view(receiver?.state, workUpTo))
      : role === 'send' ? view(sender?.state, workUpTo) : null;
    return { success: true, data: { role, state, staged } };
  });

  return { stop: async () => { generation++; await stopAll(); }, active: () => role !== null };
}
