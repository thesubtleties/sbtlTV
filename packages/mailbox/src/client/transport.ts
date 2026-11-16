/** HTTP to the mailbox: version header, proof-of-work on writes, errors as MailboxError codes. */
import { CHALLENGE_HEADER, CHALLENGE_TTL_MS, LEVEL_HEADER, MAX_DROP_BYTES, POW_BITS_HEADER, POW_HEADER, VERSION_HEADER, powBitsFor, powInput, solvePowAsync, type ErrorCode } from '../protocol/index.js';

export type Fetch = (req: Request) => Promise<Response>;
export interface TransportOpts {
  base: string; version: string; fetch: Fetch; now?: () => number;
  /** The level to assume before the server has said (it says on every reply and in /v1/hello) */
  bits?: number;
  /** Called before each proof with its difficulty, so the app can say how long it may take */
  onWork?: (bits: number) => void;
}

export class MailboxError extends Error {
  constructor(readonly code: ErrorCode | 'offline' | 'cancelled') { super(code); }
}

/** A challenge is used while comfortably young (the relay accepts one for CHALLENGE_TTL_MS). */
const CHALLENGE_REFRESH_MS = CHALLENGE_TTL_MS / 3;
/** No reply from the relay is bigger than a drop as base64 in JSON. */
const MAX_REPLY_CHARS = Math.ceil(MAX_DROP_BYTES * 4 / 3) + 4096;

/** The most work the app will do for one request (2^28 ≈ 270 M hashes, ~4 min on an average computer). */
const MAX_BITS = 28;

export class Transport {
  /** The latest challenge the relay gave (every reply carries one) and when it arrived (our clock) */
  private challenge: { value: string; at: number } | null = null;
  /** The relay's current level, from its last reply; null until it has said */
  private level: number | null = null;
  private stopped = false;
  constructor(private o: TransportOpts) {}

  private clock(): number { return (this.o.now ?? Date.now)(); }

  /** Stops any proof-of-work in progress (it throws) and makes later requests fail as cancelled. */
  stop(): void { this.stopped = true; }

  /** The level and a challenge before the first proof (or when the challenge is getting old). */
  private async hello(): Promise<void> {
    try { await this.send('GET', '/v1/hello', undefined, false); } catch { /* the write itself will report it */ }
  }

  private async send(method: string, path: string, body: unknown, pow: boolean, bits?: number, retried = false): Promise<Response> {
    const text = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = { [VERSION_HEADER]: this.o.version };
    if (text) headers['content-type'] = 'application/json';
    if (pow && (this.level === null || !this.challenge || this.clock() - this.challenge.at > CHALLENGE_REFRESH_MS) && bits === undefined) await this.hello();
    // Bigger bodies cost more (same rule as the relay), so the first proof is already enough
    const need = bits ?? powBitsFor(this.level ?? this.o.bits ?? 20, Buffer.byteLength(text));
    // More than ~4 minutes on an average computer: say "busy, try later" now rather than make someone wait
    if (pow && need > MAX_BITS) throw new MailboxError('busy');
    // No challenge yet (hello unreachable): send without a proof; the refusal carries one, then retry
    if (pow && this.challenge) {
      this.o.onWork?.(need);
      const challenge = this.challenge.value;
      let nonce: string;
      try {
        nonce = await solvePowAsync(powInput(path, text, challenge, this.o.version), need, undefined, undefined, () => this.stopped);
      } catch {
        throw new MailboxError('cancelled');
      }
      headers[POW_HEADER] = `${challenge}.${nonce}`;
    }
    let res: Response;
    try {
      res = await this.o.fetch(new Request(this.o.base + path, { method, headers, body: text || undefined }));
    } catch {
      throw new MailboxError('offline');
    }
    const challenge = res.headers.get(CHALLENGE_HEADER);
    if (challenge) this.challenge = { value: challenge, at: this.clock() };
    const level = Number(res.headers.get(LEVEL_HEADER));
    if (Number.isInteger(level) && level > 0 && level <= MAX_BITS) this.level = level;
    // A refused proof: redo once with the fresh challenge from this reply, at the relay's difficulty if it wants more
    if (res.status === 428 && pow && !retried) {
      const want = Number(res.headers.get(POW_BITS_HEADER));
      if (Number.isInteger(want) && want > MAX_BITS) throw new MailboxError('busy');
      return this.send(method, path, body, true, Number.isInteger(want) && want > need ? want : need, true);
    }
    // The relay down behind its proxy (502/503/504) is "couldn't reach it", not "something went wrong"
    if (res.status >= 500) throw new MailboxError('offline');
    if (!res.ok) {
      let code: ErrorCode = 'bad-request';
      try { code = ((await res.json()) as { error?: ErrorCode }).error ?? code; } catch { /* not json */ }
      throw new MailboxError(code);
    }
    return res;
  }

  /** A reply's JSON, refusing anything larger than a drop could be (a broken or hostile relay). */
  private async json<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (text.length > MAX_REPLY_CHARS) throw new MailboxError('bad-request');
    return JSON.parse(text) as T;
  }

  async get<T>(path: string): Promise<T> { return this.json<T>(await this.send('GET', path, undefined, false)); }
  async post<T>(path: string, body: unknown, pow: boolean): Promise<T | null> {
    const res = await this.send('POST', path, body, pow);
    return res.status === 204 ? null : this.json<T>(res);
  }
  async put(path: string, body: unknown): Promise<void> { await this.send('PUT', path, body, true); }
}

/** Polls ride out a brief network hiccup: only this many failed polls in a row end a knock. */
export const POLL_MISSES_ALLOWED = 3;

/** A poll that returns null on a passing network error and throws once they've piled up. */
export function tolerantPoll(t: Transport): <T>(path: string) => Promise<T | null> {
  let misses = 0;
  return async <T>(path: string) => {
    try {
      const out = await t.get<T>(path);
      misses = 0;
      return out;
    } catch (e) {
      if (e instanceof MailboxError && e.code === 'offline' && ++misses < POLL_MISSES_ALLOWED) return null;
      throw e;
    }
  };
}
