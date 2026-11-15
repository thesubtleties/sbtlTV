/**
 * Settings > Sync & transfer: Send to a device / Show my code. The decrypted setup never goes to
 * the page; the page sees states, words and the preview. Logs event names only.
 * Bundled by esbuild (scripts/bundle-data.mjs) because it imports @sbtltv/mailbox (TypeScript).
 */
import { app, ipcMain, net } from 'electron';
import { randomUUID } from 'node:crypto';
import { Receiver, Sender, Transport, type ReceiveState, type SendState } from '@sbtltv/mailbox/client';
import { buildBody } from '../setup-transfer.js';
import { packSetup, sendBody, unpackSetup, type SendSelection } from '../setup-send.js';
import { validateSetupBody, type SetupBody, type SetupPreview, type UserLists } from '../setup-body.js';
import { EFF_WORDS } from '../eff-wordlist.js';

export const MAILBOX_BASE = 'https://mailbox.sbtltv.com';

/** What the page may see of a state: never the received payload. */
const view = (s: ReceiveState | SendState | null | undefined) => (s && s.step === 'received' ? { step: 'received' } : s ?? null);

export function registerMailbox(deps: { stage(body: SetupBody): { token: string; preview: SetupPreview }; log: (m: string) => void }): void {
  const transport = () => new Transport({
    base: process.env.SBTLTV_MAILBOX || MAILBOX_BASE,
    version: app.getVersion(),
    fetch: (req) => net.fetch(req, { cache: 'no-store' } as RequestInit),
  });
  let role: 'receive' | 'send' | null = null;
  let receiver: Receiver | null = null;
  let sender: Sender | null = null;
  let pending: Buffer | null = null;
  let staged: { token: string; preview: SetupPreview } | undefined;
  let receiveFailed = false;   // the payload arrived but wasn't a valid setup

  const stopAll = async () => {
    const r = receiver, s = sender;
    receiver = null; sender = null; pending = null; staged = undefined; role = null; receiveFailed = false;
    await r?.cancel(); await s?.cancel();
  };

  ipcMain.handle('mailbox:receive', async () => {
    await stopAll();
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
    try {
      await stopAll();
      role = 'send';
      const base = buildBody(sel.parts, sel.lists ?? {}, sel.playlists ?? {});
      const body = validateSetupBody(sendBody(base, sel, randomUUID));
      pending = packSetup(body);
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

  ipcMain.handle('mailbox:cancel', async () => { await stopAll(); return { success: true }; });

  ipcMain.handle('mailbox:state', () => {
    const state = role === 'receive'
      ? (receiveFailed ? { step: 'failed', reason: 'broken' } : view(receiver?.state))
      : role === 'send' ? view(sender?.state) : null;
    return { success: true, data: { role, state, staged } };
  });
}
