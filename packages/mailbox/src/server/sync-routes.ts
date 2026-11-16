// packages/mailbox/src/server/sync-routes.ts
/**
 * Sync on the relay: computers in a group each keep one sealed box here. The relay checks the
 * group's token (it stores only its hash), proof-of-work on writes, and sizes; it can't open a box
 * and records nothing about who asked.
 */
import type { Context, Hono } from 'hono';
import { MAX_BOX_BYTES, MAX_COMPUTERS, tokenHash, type ErrorCode } from '../protocol/index.js';
import { sameHash, utcDay, type GroupStore, type RekeyEntry } from './groups.js';
import type { Settings } from './settings.js';

type Err = (c: Context, status: 400 | 403 | 404 | 409 | 413 | 426 | 428 | 429, error: ErrorCode) => Response;
const HEX32 = /^[0-9a-f]{32}$/;
const TOKEN = /^Bearer ([A-Za-z0-9_-]{43})$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function registerSyncRoutes(app: Hono, d: {
  groups: GroupStore; err: Err; cfg: () => Settings; now: () => number;
  guardWrite: (c: Context) => Promise<string | Response>;
}) {
  const today = () => utcDay(d.now());
  const ids = (c: Context, ...names: string[]) => names.every((n) => HEX32.test(c.req.param(n) ?? ''));
  const token = (c: Context): Buffer | null => {
    const m = TOKEN.exec(c.req.header('authorization') ?? '');
    return m ? tokenHash(m[1]) : null;
  };
  /** The group's token checked: 'ok', or the reply to send. */
  async function authorise(c: Context): Promise<'ok' | Response> {
    const th = token(c);
    if (!th) return d.err(c, 403, 'denied');
    const g = await d.groups.group(c.req.param('gid')!);
    if (!g) return d.err(c, 404, 'not-found');
    return sameHash(g.tokenHash, th) ? 'ok' : d.err(c, 403, 'denied');
  }
  const parse = (text: string): Record<string, unknown> | null => {
    try { const v: unknown = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { return null; }
  };

  // The database's id: a computer whose group is missing tells "deleted" (same id) from "the relay lost its data" (new id)
  app.get('/v1/sync/epoch', async (c) => c.json({ epoch: await d.groups.epoch() }));

  app.put('/v1/groups/:gid/boxes/:did', async (c) => {
    if (!ids(c, 'gid', 'did')) return d.err(c, 400, 'bad-request');
    if (d.cfg().syncPaused) return d.err(c, 429, 'busy');
    const th = token(c);
    if (!th) return d.err(c, 403, 'denied');
    const text = await d.guardWrite(c); if (typeof text !== 'string') return text;
    const body = parse(text);
    if (!body || typeof body.sealed !== 'string' || !B64.test(body.sealed)) return d.err(c, 400, 'bad-request');
    const sealed = Buffer.from(body.sealed, 'base64');
    if (sealed.length > MAX_BOX_BYTES) return d.err(c, 413, 'too-big');
    const gid = c.req.param('gid')!;
    if (d.cfg().newGroupsPaused && !(await d.groups.group(gid))) return d.err(c, 429, 'busy');
    const out = await d.groups.putBox(gid, th, c.req.param('did')!, sealed, today());
    if (out === 'denied') return d.err(c, 403, 'denied');
    if (out === 'moved' || out === 'full') return d.err(c, 409, out);
    return c.json(out);
  });

  app.get('/v1/groups/:gid/boxes', async (c) => {
    if (!ids(c, 'gid')) return d.err(c, 400, 'bad-request');
    const since = Number(c.req.query('since') ?? '0');
    if (!Number.isSafeInteger(since) || since < 0) return d.err(c, 400, 'bad-request');
    const auth = await authorise(c); if (auth !== 'ok') return auth;
    const l = await d.groups.list(c.req.param('gid')!, since, today());
    if (!l) return d.err(c, 404, 'not-found');
    if ('moved' in l) return c.json(l);
    return c.json({ seq: l.seq, epoch: await d.groups.epoch(), computers: l.computers, boxes: l.boxes.map((b) => ({ id: b.id, seq: b.seq, sealed: b.sealed.toString('base64') })) });
  });

  app.delete('/v1/groups/:gid/boxes/:did', async (c) => {
    if (!ids(c, 'gid', 'did')) return d.err(c, 400, 'bad-request');
    const auth = await authorise(c); if (auth !== 'ok') return auth;
    await d.groups.deleteBox(c.req.param('gid')!, c.req.param('did')!);
    return c.body(null, 204);
  });

  app.post('/v1/groups/:gid/rekey', async (c) => {
    if (!ids(c, 'gid')) return d.err(c, 400, 'bad-request');
    if (d.cfg().syncPaused) return d.err(c, 429, 'busy');
    const th = token(c);
    if (!th) return d.err(c, 403, 'denied');
    // A group the relay doesn't have (it lost its data) is created already retired; one it has
    // needs its own token, checked before any work
    const gid = c.req.param('gid')!;
    const exists = await d.groups.group(gid);
    if (exists && !sameHash(exists.tokenHash, th)) return d.err(c, 403, 'denied');
    // Creating one is a new group: the same switch as a first box
    if (!exists && d.cfg().newGroupsPaused) return d.err(c, 429, 'busy');
    const text = await d.guardWrite(c); if (typeof text !== 'string') return text;
    const body = parse(text);
    const keys = body?.keys;
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return d.err(c, 400, 'bad-request');
    const entries = Object.entries(keys as Record<string, unknown>);
    if (entries.length > MAX_COMPUTERS) return d.err(c, 400, 'bad-request');
    const map = new Map<string, RekeyEntry>();
    for (const [did, v] of entries) {
      const e = v as { sealed?: unknown; ack?: unknown } | null;
      if (!HEX32.test(did) || !e || typeof e.sealed !== 'string' || !B64.test(e.sealed) || e.sealed.length > 512) return d.err(c, 400, 'bad-request');
      if (typeof e.ack !== 'string' || !B64.test(e.ack) || Buffer.from(e.ack, 'base64').length !== 32) return d.err(c, 400, 'bad-request');
      map.set(did, { sealed: Buffer.from(e.sealed, 'base64'), ackHash: Buffer.from(e.ack, 'base64') });
    }
    if (!exists && (await d.groups.createRetired(gid, th, map, today())) === 'ok') return c.body(null, 204);
    // Created meanwhile by someone else: only its own token may move it
    const now = await d.groups.group(gid);
    if (!now || !sameHash(now.tokenHash, th)) return d.err(c, now ? 403 : 404, now ? 'denied' : 'not-found');
    const out = await d.groups.rekey(gid, map, today());
    if (!out) return d.err(c, 404, 'not-found');
    if (out === 'moved') return d.err(c, 409, 'moved');
    return c.body(null, 204);
  });

  app.get('/v1/groups/:gid/rekey/:did', async (c) => {
    if (!ids(c, 'gid', 'did')) return d.err(c, 400, 'bad-request');
    const auth = await authorise(c); if (auth !== 'ok') return auth;
    const sealed = await d.groups.getRekey(c.req.param('gid')!, c.req.param('did')!, today());
    return sealed ? c.json({ sealed: sealed.toString('base64') }) : d.err(c, 404, 'not-found');
  });

  // A computer proves it opened its new key: only this counts it as picked up (fetching doesn't)
  app.post('/v1/groups/:gid/rekey/:did/ack', async (c) => {
    if (!ids(c, 'gid', 'did')) return d.err(c, 400, 'bad-request');
    const auth = await authorise(c); if (auth !== 'ok') return auth;
    const body = parse(await c.req.text());
    const proof = typeof body?.proof === 'string' && B64.test(body.proof) ? Buffer.from(body.proof, 'base64') : null;
    if (!proof || proof.length !== 32) return d.err(c, 400, 'bad-request');
    const out = await d.groups.ackRekey(c.req.param('gid')!, c.req.param('did')!, proof, today());
    if (!out) return d.err(c, 404, 'not-found');
    return out === 'ok' ? c.body(null, 204) : d.err(c, 403, 'denied');
  });
}
