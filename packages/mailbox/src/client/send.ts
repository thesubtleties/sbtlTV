/** The giving side of a knock: rings a code, checks the commitment, seals and drops the payload. */
import { checkReveal, dropAad, dropKey, knockWords, newKeyPair, normaliseCode, seal, MAX_DROP_BYTES, type GiverPoll, type RingRes } from '../protocol/index.js';
import { MailboxError, type Transport } from './transport.js';

export type SendState =
  | { step: 'ringing' }
  | { step: 'words'; words: [string, string, string] }
  | { step: 'sending' }
  | { step: 'sent' }
  | { step: 'received' }
  | { step: 'failed'; reason: 'not-found' | 'cancelled' | 'mismatch' | 'too-big' | 'update' | 'offline' | 'busy' | 'broken' };

const b64 = (b: Buffer) => b.toString('base64');
const fromB64 = (s: string) => Buffer.from(s, 'base64');
const KNOWN = ['not-found', 'too-big', 'update', 'offline', 'busy'] as const;

export class Sender {
  state: SendState = { step: 'ringing' };
  private ticket: string | null = null;
  private key: Buffer | null = null;
  private commitmentB64: string | null = null;  // both sides know it: the drop's additional data
  private stopped = false;
  constructor(private t: Transport, private wordlist: readonly string[], private onChange: (s: SendState) => void, private opts: { pollMs?: number } = {}) {}

  private set(s: SendState) { this.state = s; this.onChange(s); }
  private fail(e: unknown) {
    const code = e instanceof MailboxError ? e.code : 'broken';
    this.stopped = true;
    // Let the receiver know rather than leaving it waiting for a drop that won't come
    if (this.ticket) void this.t.post(`/v1/ring/${this.ticket}/cancel`, undefined, false).catch(() => {});
    this.set({ step: 'failed', reason: (KNOWN as readonly string[]).includes(code) ? (code as (typeof KNOWN)[number]) : 'broken' });
  }
  private wait = () => new Promise((r) => setTimeout(r, this.opts.pollMs ?? 2000));

  async ring(input: string): Promise<void> {
    this.stopped = false;
    this.ticket = null; this.key = null; this.commitmentB64 = null;
    this.set({ step: 'ringing' });
    const code = normaliseCode(input);
    if (!code) return this.set({ step: 'failed', reason: 'not-found' });
    const mine = newKeyPair();
    try {
      // Commitment first, key after: the receiver's key is fixed before ours is seen
      const r = (await this.t.post<RingRes>('/v1/ring', { code }, true))!;
      this.ticket = r.ticket;
      if (this.stopped) {   // cancelled while the ring was in flight: give the code back as cancelled
        await this.t.post(`/v1/ring/${r.ticket}/cancel`, undefined, false).catch(() => {});
        return;
      }
      this.commitmentB64 = r.commitment;
      const commitment = fromB64(r.commitment);
      await this.t.post(`/v1/ring/${r.ticket}/key`, { giverKey: b64(mine.publicRaw) }, false);
      // Polls until the words show, then on while they're shown so a cancel on their side shows here
      while (!this.stopped && (this.state.step === 'ringing' || this.state.step === 'words')) {
        await this.wait();
        if (this.stopped || this.state.step !== 'ringing' && this.state.step !== 'words') return;
        const p = await this.t.get<GiverPoll>(`/v1/ring/${r.ticket}`);
        if (p.status === 'cancelled') { this.stopped = true; return this.set({ step: 'failed', reason: 'cancelled' }); }
        if (this.state.step === 'ringing' && p.status === 'revealed' && p.receiverKey && p.r) {
          const receiverPub = fromB64(p.receiverKey);
          if (!checkReveal(commitment, receiverPub, fromB64(p.r))) {
            await this.cancel();
            return this.set({ step: 'failed', reason: 'mismatch' });
          }
          this.key = dropKey(mine, receiverPub, commitment);
          this.set({ step: 'words', words: knockWords(commitment, mine.publicRaw, receiverPub, this.wordlist) });
        }
      }
    } catch (e) {
      this.fail(e);
    }
  }

  async confirm(payload: Buffer): Promise<void> {
    if (!this.ticket || !this.key || !this.commitmentB64 || this.state.step !== 'words') return;
    this.set({ step: 'sending' });
    try {
      const sealed = seal(this.key, payload, dropAad(this.commitmentB64));
      if (sealed.length > MAX_DROP_BYTES) throw new MailboxError('too-big');
      await this.t.put(`/v1/ring/${this.ticket}/drop`, { sealed: b64(sealed) });
      this.set({ step: 'sent' });
      while (!this.stopped) {
        await this.wait();
        if (this.stopped) return;
        const p = await this.t.get<GiverPoll>(`/v1/ring/${this.ticket}`);
        if (p.status === 'gone') { this.stopped = true; return this.set({ step: 'received' }); }
        if (p.status === 'cancelled') { this.stopped = true; return this.set({ step: 'failed', reason: 'cancelled' }); }
      }
    } catch (e) {
      this.fail(e);
    }
  }

  async cancel(): Promise<void> {
    this.stopped = true;
    if (this.ticket && this.state.step !== 'received') await this.t.post(`/v1/ring/${this.ticket}/cancel`, undefined, false).catch(() => {});
  }
}
