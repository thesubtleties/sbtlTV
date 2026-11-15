/** HTTP to the mailbox: version header, proof-of-work on writes, errors as MailboxError codes. */
import { POW_HEADER, VERSION_HEADER, powInput, solvePow, type ErrorCode } from '../protocol/index.js';

export type Fetch = (req: Request) => Promise<Response>;
export interface TransportOpts { base: string; version: string; fetch: Fetch; now?: () => number; bits?: number }

export class MailboxError extends Error {
  constructor(readonly code: ErrorCode | 'offline') { super(code); }
}

/** The most work we'll do if the server asks for more than we sent. */
const MAX_BITS = 28;

export class Transport {
  constructor(private o: TransportOpts) {}

  private async send(method: string, path: string, body: unknown, pow: boolean, bits = this.o.bits ?? 20): Promise<Response> {
    const text = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = { [VERSION_HEADER]: this.o.version };
    if (text) headers['content-type'] = 'application/json';
    if (pow) {
      const minute = Math.floor((this.o.now ?? Date.now)() / 60_000);
      headers[POW_HEADER] = `${minute}.${solvePow(powInput(path, text, minute, this.o.version), bits)}`;
    }
    let res: Response;
    try {
      res = await this.o.fetch(new Request(this.o.base + path, { method, headers, body: text || undefined }));
    } catch {
      throw new MailboxError('offline');
    }
    // The server asks for more work than we did: redo once at its difficulty
    if (res.status === 428 && pow) {
      const need = Number(res.headers.get('x-sbtltv-pow-bits'));
      if (Number.isInteger(need) && need > bits && need <= MAX_BITS) return this.send(method, path, body, true, need);
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
