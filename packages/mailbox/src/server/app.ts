/**
 * The sbtlTV mailbox: relays the knock and holds one sealed drop until pickup. It can't read
 * anything it holds and writes nothing about requests anywhere.
 */
import { Hono, type Context } from 'hono';
import { MAX_DROP_BYTES, POW_HEADER, VERSION_HEADER, checkPow, normaliseCode, powInput, versionAtLeast, type ErrorCode } from '../protocol';
import { KnockStore } from './store';
import { SeenProofs, SenderLimiter } from './limits';

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const isB64 = (v: unknown, bytes: number): v is string => typeof v === 'string' && B64.test(v) && Buffer.from(v, 'base64').length === bytes;
const HEX32 = /^[0-9a-f]{32}$/;

export interface MailboxOptions { now?: () => number; powBits?: number; minVersion?: string; maxActive?: number; writesPerHour?: number }

export function createApp(opts: MailboxOptions = {}) {
  const now = opts.now ?? Date.now;
  const bits = opts.powBits ?? 20;
  const minVersion = opts.minVersion ?? '0.0.0';
  const store = new KnockStore(now, opts.maxActive);
  const limiter = new SenderLimiter(now, opts.writesPerHour ?? 5_000);
  const proofs = new SeenProofs(now);
  const app = new Hono();

  const err = (c: Context, status: 400 | 404 | 413 | 426 | 428 | 429, error: ErrorCode, headers?: Record<string, string>) => c.json({ error }, status, headers);

  app.use('/v1/*', async (c, next) => {
    if (!versionAtLeast(c.req.header(VERSION_HEADER) ?? '', minVersion)) return err(c, 426, 'update');
    await next();
  });

  /** Proof-of-work and the per-sender cap for writes. Returns the body text or a Response. */
  async function guardWrite(c: Context): Promise<string | Response> {
    const ip = (c.req.header('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
    if (!limiter.hit(ip)) return err(c, 429, 'busy');
    const text = await c.req.text();
    const [minuteText, nonce] = (c.req.header(POW_HEADER) ?? '').split('.');
    const minute = Number(minuteText);
    const fresh = Number.isInteger(minute) && Math.abs(Math.floor(now() / 60_000) - minute) <= 2;
    const input = fresh ? powInput(c.req.path, text, minute, c.req.header(VERSION_HEADER) ?? '') : '';
    if (!fresh || !nonce || !checkPow(input, nonce, bits) || !proofs.use(input + nonce)) {
      return err(c, 428, 'pow', { 'x-sbtltv-pow-bits': String(bits) });
    }
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
    if (!body || !code || !isB64(body.giverKey, 32)) return err(c, 400, 'bad-request');
    // Unknown, expired and already-rung codes look the same: a code rings once
    const k = store.byCodeLive(code);
    if (!k || k.status !== 'waiting') return err(c, 404, 'not-found');
    const ticket = store.ring(k, body.giverKey);
    return c.json({ ticket, commitment: k.commitment }, 201);
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
    const text = await guardWrite(c); if (typeof text !== 'string') return text;
    const body = parse(text);
    if (!body || typeof body.sealed !== 'string' || !B64.test(body.sealed)) return err(c, 400, 'bad-request');
    if (Buffer.byteLength(body.sealed, 'base64') > MAX_DROP_BYTES) return err(c, 413, 'too-big');
    store.drop(k, body.sealed);
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
