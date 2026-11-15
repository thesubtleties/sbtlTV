/** The receiving side of a knock: shows a code, reveals its key once rung, opens the drop. */
import { dropAad, dropKey, knockWords, newReceiverSecret, open, type CreateKnockRes, type DropRes, type ReceiverPoll } from '../protocol';
import { MailboxError, type Transport } from './transport';

export type ReceiveState =
  | { step: 'starting' }
  | { step: 'code'; code: string; expiresAt: number }
  | { step: 'words'; words: [string, string, string] }
  | { step: 'received'; payload: Buffer }
  | { step: 'failed'; reason: 'expired' | 'cancelled' | 'update' | 'offline' | 'busy' | 'broken' };

const b64 = (b: Buffer) => b.toString('base64');
const fromB64 = (s: string) => Buffer.from(s, 'base64');

export class Receiver {
  state: ReceiveState = { step: 'starting' };
  private id: string | null = null;
  private stopped = false;
  constructor(private t: Transport, private wordlist: readonly string[], private onChange: (s: ReceiveState) => void, private opts: { pollMs?: number } = {}) {}

  private set(s: ReceiveState) { this.state = s; this.onChange(s); }
  private fail(e: unknown) {
    if (this.stopped && this.state.step === 'failed') return;
    const code = e instanceof MailboxError ? e.code : 'broken';
    const reason = code === 'not-found' ? 'expired' : code === 'update' || code === 'offline' || code === 'busy' ? code : 'broken';
    this.stopped = true;
    this.set({ step: 'failed', reason });
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.set({ step: 'starting' });
    const secret = newReceiverSecret();
    const commitment = b64(secret.commitment);
    try {
      const k = (await this.t.post<CreateKnockRes>('/v1/knock', { commitment }, true))!;
      if (this.stopped) return;
      this.id = k.id;
      this.set({ step: 'code', code: k.code, expiresAt: k.expiresAt });
      let giverKey: Buffer | null = null;
      while (!this.stopped) {
        await new Promise((r) => setTimeout(r, this.opts.pollMs ?? 2000));
        if (this.stopped) return;
        const p = await this.t.get<ReceiverPoll>(`/v1/knock/${k.id}`);
        if (p.status === 'cancelled') { this.stopped = true; return this.set({ step: 'failed', reason: 'cancelled' }); }
        if (p.status === 'rung' && p.giverKey && !giverKey) {
          giverKey = fromB64(p.giverKey);
          await this.t.post(`/v1/knock/${k.id}/reveal`, { receiverKey: b64(secret.keys.publicRaw), r: b64(secret.r) }, false);
          this.set({ step: 'words', words: knockWords(secret.commitment, giverKey, secret.keys.publicRaw, this.wordlist) });
        }
        if (p.status === 'dropped' && giverKey) {
          const d = await this.t.get<DropRes>(`/v1/knock/${k.id}/drop`);
          if (!fromB64(d.giverKey).equals(giverKey)) throw new MailboxError('bad-request');
          const payload = open(dropKey(secret.keys, giverKey, secret.commitment), fromB64(d.sealed), dropAad(commitment));
          this.stopped = true;
          return this.set({ step: 'received', payload });
        }
      }
    } catch (e) {
      this.fail(e);
    }
  }

  async cancel(): Promise<void> {
    const was = this.state.step;
    this.stopped = true;
    if (this.id && was !== 'received') await this.t.post(`/v1/knock/${this.id}/cancel`, undefined, false).catch(() => {});
    if (was !== 'received' && was !== 'failed') this.set({ step: 'failed', reason: 'cancelled' });
  }
}
