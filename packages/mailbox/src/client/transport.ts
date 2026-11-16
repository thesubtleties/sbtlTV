/** HTTP to the mailbox: version header, proof-of-work on writes, errors as MailboxError codes. */
import { LEVEL_HEADER, POW_HEADER, TIME_HEADER, VERSION_HEADER, powBitsFor, powInput, solvePowAsync, type ErrorCode } from '../protocol/index.js';

export type Fetch = (req: Request) => Promise<Response>;
export interface TransportOpts {
  base: string; version: string; fetch: Fetch; now?: () => number;
  /** The level to assume before the server has said (it says on every reply and in /v1/hello) */
  bits?: number;
  /** Called before each proof with its difficulty, so the app can say how long it may take */
  onWork?: (bits: number) => void;
}

export class MailboxError extends Error {
  constructor(readonly code: ErrorCode | 'offline') { super(code); }
}

/** The most work the app will do for one request (2^28 ≈ 270 M hashes, ~4 min on an average computer). */
const MAX_BITS = 28;

export class Transport {
  /** Server clock minus ours, learned from every reply (a computer's clock can be minutes off). */
  private offset = 0;
  /** The server's current level, from its last reply; null until it has said */
  private level: number | null = null;
  constructor(private o: TransportOpts) {}

  /** Learn the level and the clock before the first proof, so it's right the first time. */
  private async hello(): Promise<void> {
    try { await this.send('GET', '/v1/hello', undefined, false); } catch { /* the write itself will report it */ }
  }

  private serverNow(): number { return (this.o.now ?? Date.now)() + this.offset; }

  private async send(method: string, path: string, body: unknown, pow: boolean, bits?: number, retried = false): Promise<Response> {
    const text = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = { [VERSION_HEADER]: this.o.version };
    if (text) headers['content-type'] = 'application/json';
    // Bigger bodies cost more (same rule as the server), so the first proof is already enough
    if (pow && this.level === null && bits === undefined) await this.hello();
    const need = bits ?? powBitsFor(this.level ?? this.o.bits ?? 20, Buffer.byteLength(text));
    const before = this.offset;
    // More than ~4 minutes on an average computer (a full-size send while the mailbox is under load):
    // say "busy, try later" now rather than make someone wait that long
    if (pow && need > MAX_BITS) throw new MailboxError('busy');
    if (pow) {
      this.o.onWork?.(need);
      const minute = Math.floor(this.serverNow() / 60_000);
      headers[POW_HEADER] = `${minute}.${await solvePowAsync(powInput(path, text, minute, this.o.version), need)}`;
    }
    let res: Response;
    try {
      res = await this.o.fetch(new Request(this.o.base + path, { method, headers, body: text || undefined }));
    } catch {
      throw new MailboxError('offline');
    }
    const serverTime = Number(res.headers.get(TIME_HEADER));
    if (Number.isFinite(serverTime) && serverTime > 0) this.offset = serverTime - (this.o.now ?? Date.now)();
    const level = Number(res.headers.get(LEVEL_HEADER));
    if (Number.isInteger(level) && level > 0 && level <= MAX_BITS) this.level = level;
    // Refused proof: redo once, at the server's difficulty if it wants more, with its clock if ours was off
    if (res.status === 428 && pow && !retried) {
      const want = Number(res.headers.get('x-sbtltv-pow-bits'));
      const harder = Number.isInteger(want) && want > need && want <= MAX_BITS;
      const clockFixed = Math.abs(this.offset - before) >= 30_000;
      if (harder || clockFixed) return this.send(method, path, body, true, harder ? want : need, true);
    }
    if (!res.ok) {
      let code: ErrorCode = 'bad-request';
      try { code = ((await res.json()) as { error?: ErrorCode }).error ?? code; } catch { /* not json */ }
      throw new MailboxError(code);
    }
    return res;
  }

  async get<T>(path: string): Promise<T> { return (await this.send('GET', path, undefined, false)).json() as Promise<T>; }
  async post<T>(path: string, body: unknown, pow: boolean): Promise<T | null> {
    const res = await this.send('POST', path, body, pow);
    return res.status === 204 ? null : (res.json() as Promise<T>);
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
