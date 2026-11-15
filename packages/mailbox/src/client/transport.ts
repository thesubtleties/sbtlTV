/** HTTP to the mailbox: version header, proof-of-work on writes, errors as MailboxError codes. */
import { POW_HEADER, TIME_HEADER, VERSION_HEADER, powBitsFor, powInput, solvePowAsync, type ErrorCode } from '../protocol/index.js';

export type Fetch = (req: Request) => Promise<Response>;
export interface TransportOpts { base: string; version: string; fetch: Fetch; now?: () => number; bits?: number }

export class MailboxError extends Error {
  constructor(readonly code: ErrorCode | 'offline') { super(code); }
}

/** The most work we'll do if the server asks for more than we sent. */
const MAX_BITS = 28;

export class Transport {
  /** Server clock minus ours, learned from every reply (a computer's clock can be minutes off). */
  private offset = 0;
  constructor(private o: TransportOpts) {}

  private serverNow(): number { return (this.o.now ?? Date.now)() + this.offset; }

  private async send(method: string, path: string, body: unknown, pow: boolean, bits?: number, retried = false): Promise<Response> {
    const text = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = { [VERSION_HEADER]: this.o.version };
    if (text) headers['content-type'] = 'application/json';
    // Bigger bodies cost more (same rule as the server), so the first proof is already enough
    const need = bits ?? powBitsFor(this.o.bits ?? 20, Buffer.byteLength(text));
    const before = this.offset;
    if (pow) {
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
