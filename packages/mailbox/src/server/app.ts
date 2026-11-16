/**
 * The sbtlTV mailbox: relays the knock and holds one sealed drop until pickup. It can't read
 * anything it holds and writes nothing about requests anywhere.
 */
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LEVEL_HEADER, MAX_DROP_BYTES, POW_HEADER, TIME_HEADER, VERSION_HEADER, checkPow, normaliseCode, powBitsFor, powInput, versionAtLeast, type ErrorCode } from '../protocol/index.js';
import { KnockStore } from './store.js';
import { SeenProofs, SenderLimiter } from './limits.js';
import { PowGovernor } from './governor.js';

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const isB64 = (v: unknown, bytes: number): v is string => typeof v === 'string' && B64.test(v) && Buffer.from(v, 'base64').length === bytes;
const HEX32 = /^[0-9a-f]{32}$/;

export interface MailboxOptions {
  now?: () => number; powBits?: number; minVersion?: string; maxActive?: number; maxStoredBytes?: number; writesPerHour?: number;
  /** Bytes of large drops (over LARGE_DROP_BYTES) accepted per hour, all senders together */
  largeDropBytesPerHour?: number;
  /** Switches: refuse all writes / refuse large drops ("busy"), without a release */
  paused?: boolean; largeDropsPaused?: boolean;
}

/** Drops above this are "large": a real setup is ~1 KB; only file playlists get this big. */
export const LARGE_DROP_BYTES = 256 * 1024;

export function createApp(opts: MailboxOptions = {}) {
  const now = opts.now ?? Date.now;
  const bits = opts.powBits ?? 20;
  const minVersion = opts.minVersion ?? '0.0.0';
  const store = new KnockStore(now, opts.maxActive, opts.maxStoredBytes);
  const limiter = new SenderLimiter(now, opts.writesPerHour ?? 5_000);
  const proofs = new SeenProofs(now);
  const governor = new PowGovernor(now, { base: bits });
  const largeBudget = opts.largeDropBytesPerHour ?? 200 * 1024 * 1024;
  let largeHour = -1;
  let largeUsed = 0;
  const largeRoom = (bytes: number) => {
    const h = Math.floor(now() / 3_600_000);
    if (h !== largeHour) { largeHour = h; largeUsed = 0; }
    return largeUsed + bytes <= largeBudget;
  };
  const app = new Hono();

  const err = (c: Context, status: 400 | 404 | 413 | 426 | 428 | 429, error: ErrorCode, headers?: Record<string, string>) => c.json({ error }, status, headers);

  // Every reply carries the server's clock, so a client with a wrong clock can still prove work
  // ...and the proof-of-work level a new request needs
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set(TIME_HEADER, String(now()));
    c.res.headers.set(LEVEL_HEADER, String(governor.bits()));
  });

  // Bodies are capped before anything reads them: small for the knock, the drop's size for drops
  const tooBig = (c: Context) => err(c, 413, 'too-big');
  const DROP_ROUTE = /^\/v1\/ring\/[^/]+\/drop$/;
  const small = bodyLimit({ maxSize: 8 * 1024, onError: tooBig });
  const large = bodyLimit({ maxSize: Math.ceil(MAX_DROP_BYTES * 4 / 3) + 1024, onError: tooBig });
  app.use('/v1/*', (c, next) => (DROP_ROUTE.test(c.req.path) ? large : small)(c, next));

  app.use('/v1/*', async (c, next) => {
    if (!versionAtLeast(c.req.header(VERSION_HEADER) ?? '', minVersion)) return err(c, 426, 'update');
    await next();
  });

  /** Proof-of-work (more for bigger bodies) and the per-sender cap for writes. Returns the body text or a Response. */
  async function guardWrite(c: Context): Promise<string | Response> {
    if (opts.paused) return err(c, 429, 'busy');
    // The proxy appends the address it saw; anything before it is whatever the client wrote
    const ip = (c.req.header('x-forwarded-for') ?? '').split(',').pop()?.trim() || 'unknown';
    const text = await c.req.text();
    const need = powBitsFor(governor.accepted(), Buffer.byteLength(text));
    const [minuteText, nonce] = (c.req.header(POW_HEADER) ?? '').split('.');
    const minute = Number(minuteText);
    const fresh = Number.isInteger(minute) && Math.abs(Math.floor(now() / 60_000) - minute) <= 2;
    const input = fresh ? powInput(c.req.path, text, minute, c.req.header(VERSION_HEADER) ?? '') : '';
    if (!fresh || !nonce || !checkPow(input, nonce, need) || !proofs.use(input + nonce)) {
      return err(c, 428, 'pow', { 'x-sbtltv-pow-bits': String(powBitsFor(governor.bits(), Buffer.byteLength(text))) });
    }
    governor.proven();
    // Counted only once the work is proven: junk requests can't use up the limit for everyone
    if (!limiter.hit(ip)) return err(c, 429, 'busy');
    return text;
  }

  const parse = (text: string): Record<string, unknown> | null => {
    try {
      const v: unknown = JSON.parse(text);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  // Where a send starts: the current level and the server's clock, no work needed
  app.get('/v1/hello', (c) => c.json({ bits: governor.bits(), time: now() }));

  app.post('/v1/knock', async (c) => {
    const text = await guardWrite(c); if (typeof text !== 'string') return text;
    const body = parse(text);
    if (!body || !isB64(body.commitment, 32)) return err(c, 400, 'bad-request');
    const k = store.create(body.commitment);
    if (!k) return err(c, 429, 'busy');
    return c.json({ id: k.id, code: k.code, expiresAt: k.expiresAt }, 201);
  });

  app.get('/v1/knock/:id', (c) => {
    const id = c.req.param('id');
    const k = HEX32.test(id) ? store.byIdLive(id) : undefined;
    if (!k) return err(c, 404, 'not-found');
    return c.json(k.status === 'rung' ? { status: k.status, giverKey: k.giverKey } : { status: k.status });
  });

  app.post('/v1/knock/:id/reveal', async (c) => {
    const k = store.byIdLive(c.req.param('id'));
    if (!k || k.status !== 'rung') return err(c, 404, 'not-found');
    const body = parse(await c.req.text());
    if (!body || !isB64(body.receiverKey, 32) || !isB64(body.r, 16)) return err(c, 400, 'bad-request');
    k.receiverKey = body.receiverKey; k.r = body.r; k.status = 'revealed';
    return c.body(null, 204);
  });

  app.get('/v1/knock/:id/drop', (c) => {
    const k = store.byIdLive(c.req.param('id'));
    if (!k || k.status !== 'dropped' || !k.sealed || !k.giverKey) return err(c, 404, 'not-found');
    const out = { sealed: k.sealed, giverKey: k.giverKey };
    store.finish(k, 'gone');
    return c.json(out);
  });

  app.post('/v1/knock/:id/cancel', (c) => {
    const k = store.byIdLive(c.req.param('id'));
    if (k) store.finish(k, 'cancelled');
    return c.body(null, 204);
  });

  app.post('/v1/ring', async (c) => {
    const text = await guardWrite(c); if (typeof text !== 'string') return text;
    const body = parse(text);
    const code = typeof body?.code === 'string' ? normaliseCode(body.code) : null;
    if (!body || !code) return err(c, 400, 'bad-request');
    // Unknown, expired and already-used codes look the same: a code rings once
    const k = store.byCodeLive(code);
    if (!k || k.status !== 'waiting') return err(c, 404, 'not-found');
    const ticket = store.claim(k);
    return c.json({ ticket, commitment: k.commitment }, 201);
  });

  // Only after the giver holds the commitment: its key can't be matched to one chosen later
  app.post('/v1/ring/:ticket/key', async (c) => {
    const k = store.byTicketLive(c.req.param('ticket'));
    if (!k || k.status !== 'claimed') return err(c, 404, 'not-found');
    const body = parse(await c.req.text());
    if (!body || !isB64(body.giverKey, 32)) return err(c, 400, 'bad-request');
    if (!store.setGiverKey(k, body.giverKey)) return err(c, 404, 'not-found');
    return c.body(null, 204);
  });

  app.get('/v1/ring/:ticket', (c) => {
    const ticket = c.req.param('ticket');
    const k = HEX32.test(ticket) ? store.byTicketLive(ticket) : undefined;
    if (!k) return err(c, 404, 'not-found');
    return c.json(k.status === 'revealed' ? { status: k.status, receiverKey: k.receiverKey, r: k.r } : { status: k.status });
  });

  app.put('/v1/ring/:ticket/drop', async (c) => {
    const k = store.byTicketLive(c.req.param('ticket'));
    if (!k || k.status !== 'revealed') return err(c, 404, 'not-found');
    // Too big is said before any proof-of-work is checked (the client wouldn't solve a harder one for nothing)
    const raw = parse(await c.req.text());
    const size = raw && typeof raw.sealed === 'string' ? Buffer.byteLength(raw.sealed, 'base64') : 0;
    if (size > MAX_DROP_BYTES) return err(c, 413, 'too-big');
    // Large drops: switchable, and an hourly budget for everyone together (said before any work)
    const large = size > LARGE_DROP_BYTES;
    if (large && (opts.largeDropsPaused || !largeRoom(size))) return err(c, 429, 'busy');
    const text = await guardWrite(c); if (typeof text !== 'string') return text;
    const body = parse(text);
    if (!body || typeof body.sealed !== 'string' || !B64.test(body.sealed)) return err(c, 400, 'bad-request');
    const stored = store.drop(k, body.sealed);
    if (stored === 'gone') return err(c, 404, 'not-found');
    if (stored === 'busy') return err(c, 429, 'busy');
    if (large) largeUsed += size;
    return c.body(null, 204);
  });

  app.post('/v1/ring/:ticket/cancel', (c) => {
    const k = store.byTicketLive(c.req.param('ticket'));
    if (k) store.finish(k, 'cancelled');
    return c.body(null, 204);
  });

  app.get('/healthz', (c) => c.text('ok'));
  return { app, store };
}
