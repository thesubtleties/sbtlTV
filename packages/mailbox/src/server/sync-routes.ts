// packages/mailbox/src/server/sync-routes.ts
/**
 * Sync on the relay: computers in a group each keep one sealed box here. The relay checks the
 * group's token (it stores only its hash), proof-of-work on writes, and sizes; it can't open a box
 * and records nothing about who asked.
 */
import type { Context, Hono } from 'hono';
import { MAX_BOX_BYTES, MAX_COMPUTERS, tokenHash, type ErrorCode } from '../protocol/index.js';
import { sameHash, utcDay, type GroupStore } from './groups.js';
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
    return c.json({ seq: l.seq, computers: l.computers, boxes: l.boxes.map((b) => ({ id: b.id, seq: b.seq, sealed: b.sealed.toString('base64') })) });
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
    const auth = await authorise(c); if (auth !== 'ok') return auth;
    const text = await d.guardWrite(c); if (typeof text !== 'string') return text;
    const body = parse(text);
    const keys = body?.keys;
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return d.err(c, 400, 'bad-request');
    const entries = Object.entries(keys as Record<string, unknown>);
    if (entries.length > MAX_COMPUTERS) return d.err(c, 400, 'bad-request');
    const map = new Map<string, Buffer>();
    for (const [did, v] of entries) {
      if (!HEX32.test(did) || typeof v !== 'string' || !B64.test(v) || v.length > 512) return d.err(c, 400, 'bad-request');
      map.set(did, Buffer.from(v, 'base64'));
    }
    const out = await d.groups.rekey(c.req.param('gid')!, map, today());
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
}
