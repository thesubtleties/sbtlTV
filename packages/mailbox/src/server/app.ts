/**
 * The sbtlTV relay (code name: mailbox): relays the knock and holds one sealed drop until pickup.
 * It can't read anything it holds and writes nothing about requests anywhere.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  CHALLENGE_HEADER, CHALLENGE_TTL_MS, LEVEL_HEADER, MAX_DROP_BYTES, POW_BITS_HEADER, POW_HEADER, TIME_HEADER, VERSION_HEADER,
  checkPow, normaliseCode, powBitsFor, powInput, versionAtLeast, type ErrorCode,
} from '../protocol/index.js';
import { KnockStore } from './store.js';
import { SeenProofs } from './limits.js';
import { PowGovernor } from './governor.js';
import { DEFAULTS, type Settings } from './settings.js';

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Canonical base64 of exactly `bytes` bytes (re-encoding gives the same text). */
const isB64 = (v: unknown, bytes: number): v is string => {
  if (typeof v !== 'string' || !B64.test(v)) return false;
  const b = Buffer.from(v, 'base64');
  return b.length === bytes && b.toString('base64') === v;
};
const HEX32 = /^[0-9a-f]{32}$/;
/** A drop request's body at most: the sealed bytes as base64 inside a little JSON. */
const MAX_DROP_BODY = Math.ceil(MAX_DROP_BYTES * 4 / 3) + 1024;
/** Drop bodies being read at once, all knocks together (memory while uploads are in flight). */
const MAX_INFLIGHT_DROP_BYTES = 64 * 1024 * 1024;

export interface MailboxOptions {
  now?: () => number; maxActive?: number;
  /** The live knobs (settings.ts LiveSettings in production), read on every request */
  settings?: () => Settings;
  // Fixed overrides (tests), used when no `settings` is given
  powBits?: number; minVersion?: string; maxStoredBytes?: number;
  largeDropBytesPerHour?: number; paused?: boolean; largeDropsPaused?: boolean;
}

export function createApp(opts: MailboxOptions = {}) {
  const now = opts.now ?? Date.now;
  const fixed: Settings = {
    ...DEFAULTS,
    minVersion: opts.minVersion ?? '0.0.0',
    ...(opts.powBits !== undefined && { powBits: opts.powBits }),
    ...(opts.maxStoredBytes !== undefined && { dropMemoryMb: opts.maxStoredBytes / (1024 * 1024) }),
    ...(opts.largeDropBytesPerHour !== undefined && { largeDropMbPerHour: opts.largeDropBytesPerHour / (1024 * 1024) }),
    ...(opts.paused !== undefined && { paused: opts.paused }),
    ...(opts.largeDropsPaused !== undefined && { largeDropsPaused: opts.largeDropsPaused }),
  };
  const cfg = opts.settings ?? (() => fixed);
  const store = new KnockStore(now, opts.maxActive, () => cfg().dropMemoryMb * 1024 * 1024);
  const proofs = new SeenProofs(now);
  const governor = new PowGovernor(now, () => {
    const s = cfg();
    return { base: s.powBits, maxExtra: s.maxExtraBits, busyPerMinute: s.busyPerMinute, quietPerMinute: s.quietPerMinute, quietMinutes: s.quietMinutes };
  });

  // Challenges: "<issued ms, base 36>-<HMAC>" with a secret that lives only in this process. Nobody
  // can make one for later, so proofs can't be computed ahead and saved up; a restart voids them all.
  const secret = randomBytes(32);
  const mac = (stamp: string) => createHmac('sha256', secret).update(stamp).digest('base64url').slice(0, 22);
  const issueChallenge = () => { const stamp = now().toString(36); return `${stamp}-${mac(stamp)}`; };
  /** When a valid challenge was issued, or null. */
  const challengeIssuedAt = (challenge: string): number | null => {
    const m = /^([0-9a-z]{1,12})-([A-Za-z0-9_-]{22})$/.exec(challenge);
    if (!m) return null;
    const want = Buffer.from(mac(m[1])), got = Buffer.from(m[2]);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    const issued = Number.parseInt(m[1], 36);
    const age = now() - issued;
    return age >= -5_000 && age <= CHALLENGE_TTL_MS ? issued : null;
  };

  // Large drops: an hourly budget for everyone together, reserved up front (drops in flight
  // together can't overrun it) and given back if the drop isn't stored
  let largeHour = -1;
  let largeUsed = 0;
  const reserveLarge = (bytes: number): (() => void) | null => {
    const h = Math.floor(now() / 3_600_000);
    if (h !== largeHour) { largeHour = h; largeUsed = 0; }
    if (largeUsed + bytes > cfg().largeDropMbPerHour * 1024 * 1024) return null;
    largeUsed += bytes;
    return () => { if (h === largeHour) largeUsed = Math.max(0, largeUsed - bytes); };
  };
  let inflightDropBytes = 0;

  const app = new Hono();
  const err = (c: Context, status: 400 | 404 | 413 | 426 | 428 | 429, error: ErrorCode, headers?: Record<string, string>) => c.json({ error }, status, headers);

  // Nothing about a failed request is written anywhere, unexpected ones included
  app.onError((_e, c) => c.json({ error: 'bad-request' satisfies ErrorCode }, 400));

  // Every reply carries the server's clock, the proof-of-work level a new request needs and a fresh challenge
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set(TIME_HEADER, String(now()));
    c.res.headers.set(LEVEL_HEADER, String(governor.bits()));
    c.res.headers.set(CHALLENGE_HEADER, issueChallenge());
  });

  // Bodies are capped before anything reads them: small for the knock, the drop's size for drops
  const tooBig = (c: Context) => err(c, 413, 'too-big');
  const DROP_ROUTE = /^\/v1\/ring\/[^/]+\/drop$/;
  const small = bodyLimit({ maxSize: 8 * 1024, onError: tooBig });
  const large = bodyLimit({ maxSize: MAX_DROP_BODY, onError: tooBig });
  app.use('/v1/*', (c, next) => (DROP_ROUTE.test(c.req.path) ? large : small)(c, next));

  app.use('/v1/*', async (c, next) => {
    if (!versionAtLeast(c.req.header(VERSION_HEADER) ?? '', cfg().minVersion)) return err(c, 426, 'update');
    await next();
  });

  /** Proof-of-work (more for bigger bodies) for writes, checked before the body is parsed. Returns the body text or a Response. */
  async function guardWrite(c: Context): Promise<string | Response> {
    if (cfg().paused) return err(c, 429, 'busy');
    const text = await c.req.text();
    const header = c.req.header(POW_HEADER) ?? '';
    const dot = header.lastIndexOf('.');
    const challenge = header.slice(0, dot), nonce = header.slice(dot + 1);
    const issued = dot > 0 ? challengeIssuedAt(challenge) : null;
    const input = issued !== null ? powInput(c.req.path, text, challenge, c.req.header(VERSION_HEADER) ?? '') : '';
    const need = powBitsFor(governor.accepted(), Buffer.byteLength(text));
    if (issued === null || !checkPow(input, nonce, need) || !proofs.use(input + nonce, issued)) {
      return err(c, 428, 'pow', { [POW_BITS_HEADER]: String(powBitsFor(governor.bits(), Buffer.byteLength(text))) });
    }
    governor.proven();
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

  // Where a send starts: the current level, the server's clock and a challenge; no work needed
  app.get('/v1/hello', (c) => c.json({ bits: governor.bits(), time: now(), challenge: issueChallenge() }));

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
    store.pick(k);   // the bytes are gone now; the receiver says next whether they opened
    return c.json(out);
  });

  // The receiver opened the drop (ok) or couldn't: only then does the giver hear the outcome
  app.post('/v1/knock/:id/receipt', async (c) => {
    const k = store.byIdLive(c.req.param('id'));
    if (!k || k.status !== 'picked') return err(c, 404, 'not-found');
    const body = parse(await c.req.text());
    if (!body || typeof body.ok !== 'boolean') return err(c, 400, 'bad-request');
    store.finish(k, body.ok ? 'gone' : 'unreadable');
    return c.body(null, 204);
  });

  // A finished knock keeps its outcome: a late cancel doesn't turn "received" or "unreadable" into "cancelled"
  const FINAL = new Set(['gone', 'unreadable', 'cancelled']);

  app.post('/v1/knock/:id/cancel', (c) => {
    const k = store.byIdLive(c.req.param('id'));
    if (k && !FINAL.has(k.status)) store.finish(k, 'cancelled');
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
    // Everything cheap first, before a byte of the body is read: its announced size, one upload at
    // a time per knock, room for uploads in flight. (Without Content-Length, a chunked upload, the
    // body is read first, within the route's body limit, to learn its size.)
    const announced = Number(c.req.header('content-length'));
    let length: number | null = Number.isFinite(announced) && announced > 0 ? announced : null;
    if (length !== null && length > MAX_DROP_BODY) return err(c, 413, 'too-big');
    const holding = length ?? MAX_DROP_BODY;
    if (k.dropping || inflightDropBytes + holding > MAX_INFLIGHT_DROP_BYTES) return err(c, 429, 'busy');
    k.dropping = true;
    inflightDropBytes += holding;
    try {
      // The sealed bytes the body holds ({"sealed":"…"} around base64), said before any work. With
      // the text at hand its padding is counted exactly; from the header alone, up to 2 bytes of slack
      // (the exact check after parsing catches those)
      let padding = 2;
      if (length === null) {
        const text = await c.req.text();
        length = Buffer.byteLength(text);
        padding = /(=*)"\}\s*$/.exec(text)?.[1].length ?? 0;
      }
      const sealedBytes = Math.max(0, Math.floor(Math.max(0, length - 13) * 3 / 4) - padding);
      if (sealedBytes > MAX_DROP_BYTES) return err(c, 413, 'too-big');
      // Large drops: switchable, and the hourly budget for everyone together
      const isLarge = sealedBytes > cfg().largeDropKb * 1024;
      const giveBack = isLarge ? (cfg().largeDropsPaused ? null : reserveLarge(sealedBytes)) : () => {};
      if (!giveBack) return err(c, 429, 'busy');
      const text = await guardWrite(c); if (typeof text !== 'string') { giveBack(); return text; }
      const body = parse(text);
      if (!body || typeof body.sealed !== 'string' || !B64.test(body.sealed)) { giveBack(); return err(c, 400, 'bad-request'); }
      if (Buffer.byteLength(body.sealed, 'base64') > MAX_DROP_BYTES) { giveBack(); return err(c, 413, 'too-big'); }
      const stored = store.drop(k, body.sealed);
      if (stored === 'gone') { giveBack(); return err(c, 404, 'not-found'); }
      if (stored === 'busy') { giveBack(); return err(c, 429, 'busy'); }
      return c.body(null, 204);
    } finally {
      k.dropping = false;
      inflightDropBytes -= holding;
    }
  });

  app.post('/v1/ring/:ticket/cancel', (c) => {
    const k = store.byTicketLive(c.req.param('ticket'));
    if (k && !FINAL.has(k.status)) store.finish(k, 'cancelled');
    return c.body(null, 204);
  });

  app.get('/healthz', (c) => c.text('ok'));
  return { app, store };
}
