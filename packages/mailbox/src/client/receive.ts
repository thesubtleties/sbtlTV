/** The receiving side of a knock: shows a code, reveals its key once rung, opens the drop, says whether it opened. */
import { decodeB64, dropAad, dropKey, knockWords, newReceiverSecret, open, type CreateKnockRes, type DropRes, type ReceiverPoll } from '../protocol/index.js';
import { MailboxError, tolerantPoll, type Transport } from './transport.js';

export type ReceiveState =
  | { step: 'starting' }
  | { step: 'code'; code: string; expiresAt: number }
  | { step: 'words'; words: [string, string, string] }
  | { step: 'received'; payload: Buffer }
  | { step: 'failed'; reason: 'expired' | 'cancelled' | 'update' | 'offline' | 'busy' | 'broken' };

const b64 = (b: Buffer) => b.toString('base64');

export class Receiver {
  state: ReceiveState = { step: 'starting' };
  private id: string | null = null;
  private stopped = false;
  private wordsConfirmed = false;   // the person said the words match; only then is the drop opened
  /**
   * opts.accept: whether a received payload is usable (the app checks it's a valid setup). The giver
   * hears "received" only when it is, and "couldn't be read" when it isn't.
   */
  constructor(private t: Transport, private wordlist: readonly string[], private onChange: (s: ReceiveState) => void, private opts: { pollMs?: number; accept?: (payload: Buffer) => boolean } = {}) {}

  private set(s: ReceiveState) { this.state = s; this.onChange(s); }
  private fail(e: unknown) {
    if (this.stopped && this.state.step === 'failed') return;
    const code = e instanceof MailboxError ? e.code : 'broken';
    const reason = code === 'not-found' ? 'expired' : code === 'update' || code === 'offline' || code === 'busy' || code === 'cancelled' ? code : 'broken';
    this.stopped = true;
    // Let the giver know rather than leaving them waiting
    if (this.id) void this.t.post(`/v1/knock/${this.id}/cancel`, undefined, false).catch(() => {});
    this.set({ step: 'failed', reason });
  }

  /** The person saw the same words as the giver. Until then a drop is left unfetched. */
  confirmWords(): void { if (this.state.step === 'words') this.wordsConfirmed = true; }

  private async ack(ok: boolean): Promise<void> {
    if (this.id) await this.t.post(`/v1/knock/${this.id}/receipt`, { ok }, false).catch(() => {});
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.wordsConfirmed = false;
    this.set({ step: 'starting' });
    const secret = newReceiverSecret();
    const commitment = b64(secret.commitment);
    try {
      const k = (await this.t.post<CreateKnockRes>('/v1/knock', { commitment }, true))!;
      this.id = k.id;
      if (this.stopped) {   // cancelled while the code was being made: don't leave it open
        await this.t.post(`/v1/knock/${k.id}/cancel`, undefined, false).catch(() => {});
        return;
      }
      this.set({ step: 'code', code: k.code, expiresAt: k.expiresAt });
      let giverKey: Buffer | null = null;
      let key: Buffer | null = null;
      const poll = tolerantPoll(this.t);
      while (!this.stopped) {
        await new Promise((r) => setTimeout(r, this.opts.pollMs ?? 2000));
        if (this.stopped) return;
        const p = await poll<ReceiverPoll>(`/v1/knock/${k.id}`);
        if (!p) continue;
        if (p.status === 'cancelled') { this.stopped = true; return this.set({ step: 'failed', reason: 'cancelled' }); }
        if (p.status === 'rung' && p.giverKey && !giverKey) {
          // A malformed or unusable key ends it here, before any words are shown
          giverKey = decodeB64(p.giverKey, 32);
          key = dropKey(secret.keys, giverKey, secret.commitment);
          await this.t.post(`/v1/knock/${k.id}/reveal`, { receiverKey: b64(secret.keys.publicRaw), r: b64(secret.r) }, false);
          this.set({ step: 'words', words: knockWords(secret.commitment, giverKey, secret.keys.publicRaw, this.wordlist) });
        }
        if (p.status === 'dropped' && giverKey && key && this.wordsConfirmed) {
          const d = await this.t.get<DropRes>(`/v1/knock/${k.id}/drop`);
          if (!decodeB64(d.giverKey, 32).equals(giverKey)) throw new MailboxError('bad-request');
          let payload: Buffer;
          try {
            payload = open(key, decodeB64(d.sealed), dropAad(secret.commitment));
          } catch (e) {
            await this.ack(false);
            throw e;
          }
          let usable = false;
          try { usable = this.opts.accept ? this.opts.accept(payload) : true; } catch { usable = false; }
          await this.ack(usable);
          this.stopped = true;
          if (!usable) return this.set({ step: 'failed', reason: 'broken' });
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
    this.t.stop();
    if (this.id && was !== 'received') await this.t.post(`/v1/knock/${this.id}/cancel`, undefined, false).catch(() => {});
    if (was !== 'received' && was !== 'failed') this.set({ step: 'failed', reason: 'cancelled' });
  }
}
