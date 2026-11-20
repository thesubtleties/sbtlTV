// packages/mailbox/src/server/sync-routes.ts
/**
 * Sync on the relay: computers in a group each keep one sealed box here. The relay checks the
 * group's token (it stores only its hash), proof-of-work on writes, sizes, and that what's stored
 * looks sealed; it can't open a box and records nothing about who asked. Each version of a box (and
 * each new key) can be downloaded only so many times (limits.ts Downloads), so a group handed
 * around is no use as a download link.
 */
import type { Context, Hono } from 'hono';
import { BOX_PAD, MAX_BOX_BYTES, MAX_COMPUTERS, REKEY_BYTES, tokenHash, type ErrorCode } from '../protocol/index.js';
import { sameHash, utcDay, type GroupStore, type RekeyEntry } from './groups.js';
import type { Settings } from './settings.js';
import type { Downloads } from './limits.js';
import type { Metrics } from './metrics.js';
import { looksSealed, mostlyText } from './sealed-check.js';

type Err = (c: Context, status: 400 | 403 | 404 | 409 | 413 | 426 | 428 | 429, error: ErrorCode) => Response;
const HEX32 = /^[0-9a-f]{32}$/;
const TOKEN = /^Bearer ([A-Za-z0-9_-]{43})$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function registerSyncRoutes(app: Hono, d: {
  groups: GroupStore; err: Err; cfg: () => Settings; now: () => number;
  guardWrite: (c: Context) => Promise<string | Response>;
  /** Memory for an upload being read (shared with drops); null = no room now */
  reserveInflight: (bytes: number) => (() => void) | null;
  /** False until the database is ready */
  ready: () => boolean;
  maxDbBytes: () => number;
  listBudgetBytes: () => number;
  smallListBudgetBytes: () => number;
  /** A reply not fully read by then is aborted (and its memory goes with it): large / small replies */
  listHoldMs: number;
  smallListHoldMs: number;
  downloads: Downloads;
  metrics: Metrics;
}) {
  // Not ready yet, or paused (reads too: a list reply can be large): everything sync is busy
  const gate = async (c: Context, next: () => Promise<void>) => {
    if (!d.ready() || d.cfg().syncPaused) return d.err(c, 429, 'busy');
    await next();
  };
  app.use('/v1/groups/*', gate);
  app.use('/v1/sync/*', gate);
  // Every list reply holds memory until it's fully read, so each counts until then: against a budget
  // for large replies (a full re-read) or a separate one for small ones (the usual "anything new?"),
  // so full re-reads can't starve the small ones; and against its group (at most 4 at once), so a few
  // groups can't hold everyone else's. A reply not read in time is aborted, freeing its memory.
  const inFlight = { large: 0, small: 0 };
  const perGroup = new Map<string, number>();
  const SMALL_REPLY = 64 * 1024;
  const PER_GROUP = 4;
  const today = () => utcDay(d.now());
  const boxKey = (gid: string, did: string) => `${gid}/${did}`;
  const rekeyKey = (gid: string, did: string) => `${gid}/rekey/${did}`;
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
    const th = token(c);
    if (!th) return d.err(c, 403, 'denied');
    // Room for the body first, before a byte of it is read (shared with drops)
    const announced = Number(c.req.header('content-length'));
    const release = d.reserveInflight(Number.isFinite(announced) && announced > 0 ? announced : MAX_BOX_BYTES * 2);
    if (!release) return d.err(c, 429, 'busy');
    try {
      return await putBox(c, th);
    } finally {
      release();
    }
  });

  async function putBox(c: Context, th: Buffer): Promise<Response> {
    // Over the size cap a computer can still replace its own box, growing it by one 16 KB step per
    // push at most (how real boxes grow; sync keeps working for everyone already in); new boxes and
    // groups wait. 10% over the cap everything waits: the disk comes first (the alert fires long before)
    const size = await d.groups.sizeBytes();
    if (size > d.maxDbBytes() * 1.1) { d.metrics.refused.db_full++; return d.err(c, 429, 'busy'); }
    const full = size > d.maxDbBytes();
    const text = await d.guardWrite(c); if (typeof text !== 'string') return text;
    const body = parse(text);
    if (!body || typeof body.sealed !== 'string' || !B64.test(body.sealed)) return d.err(c, 400, 'bad-request');
    const sealed = Buffer.from(body.sealed, 'base64');
    if (sealed.length > MAX_BOX_BYTES) return d.err(c, 413, 'too-big');
    // The app pads every box to 16 KB steps and seals it: anything else isn't one of ours
    if (sealed.length % BOX_PAD !== 0) { d.metrics.refused.unpadded++; return d.err(c, 400, 'bad-request'); }
    if (!looksSealed(sealed)) { d.metrics.refused.unsealed++; return d.err(c, 400, 'bad-request'); }
    const gid = c.req.param('gid')!, did = c.req.param('did')!;
    if (d.cfg().newGroupsPaused && !(await d.groups.group(gid))) return d.err(c, 429, 'busy');
    const out = await d.groups.putBox(gid, th, did, sealed, today(), full);
    if (out === 'busy') { d.metrics.refused.db_full++; return d.err(c, 429, 'busy'); }
    if (out === 'denied') return d.err(c, 403, 'denied');
    if (out === 'moved' || out === 'full') return d.err(c, 409, out);
    // A new version starts its count from nothing (seq can start again at 1 in a recreated group).
    // A computer's first box: it joined, and every join re-reads all boxes, so the group starts
    // again (pairing over and over can't use up a box nobody changed; costs an abuser a proven upload)
    if (out.added) d.downloads.forgetAll(`${gid}/`); else d.downloads.forget(boxKey(gid, did));
    return c.json({ seq: out.seq });
  }

  app.get('/v1/groups/:gid/boxes', async (c) => {
    if (!ids(c, 'gid')) return d.err(c, 400, 'bad-request');
    const since = Number(c.req.query('since') ?? '0');
    if (!Number.isSafeInteger(since) || since < 0) return d.err(c, 400, 'bad-request');
    const auth = await authorise(c); if (auth !== 'ok') return auth;
    return listReply(c, since);
  });

  async function listReply(c: Context, since: number): Promise<Response> {
    const l = await d.groups.list(c.req.param('gid')!, since, today());
    if (!l) return d.err(c, 404, 'not-found');
    if ('moved' in l) return c.json(l);
    const gid = c.req.param('gid')!;
    const epoch = await d.groups.epoch();
    // From here to admitting the reply there's no await, so the check and the budgets see one moment
    if (l.boxes.some((b) => d.downloads.count(boxKey(gid, b.id), b.seq) >= d.cfg().maxBoxDownloads)) {
      d.metrics.limited.box++;
      return d.err(c, 429, 'busy');
    }
    let body: Buffer | null = Buffer.from(JSON.stringify({ seq: l.seq, epoch, computers: l.computers, boxes: l.boxes.map((b) => ({ id: b.id, seq: b.seq, sealed: b.sealed.toString('base64') })) }));
    const size = body.length;
    const kind = size <= SMALL_REPLY ? 'small' : 'large';
    const budget = kind === 'small' ? d.smallListBudgetBytes() : d.listBudgetBytes();
    if ((perGroup.get(gid) ?? 0) >= PER_GROUP || inFlight[kind] + size > budget) return d.err(c, 429, 'busy');
    inFlight[kind] += size;
    // A download counts when its reply is admitted, before a byte goes out: the server hands the
    // whole reply to the network's buffers at once, so the relay can't know how much a reader got,
    // and stopping early must not dodge the count. A pull that times out counts too; reaching the
    // limit that way takes failing pulls on a line under ~13 kbit/s
    for (const b of l.boxes) d.downloads.add(boxKey(gid, b.id), b.seq);
    perGroup.set(gid, (perGroup.get(gid) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      body = null;   // the memory goes with the share
      inFlight[kind] -= size;
      const n = (perGroup.get(gid) ?? 1) - 1;
      if (n <= 0) perGroup.delete(gid); else perGroup.set(gid, n);
    };
    let at = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(ctl) {
        // Not read in time: abort it, so the budget is given back only with the memory
        timer = setTimeout(() => { try { ctl.error(new Error('not read in time')); } catch { /* closed */ } release(); }, kind === 'small' ? d.smallListHoldMs : d.listHoldMs);
        timer.unref?.();
      },
      pull(ctl) {
        if (!body || at >= body.length) { clearTimeout(timer); ctl.close(); release(); return; }
        ctl.enqueue(new Uint8Array(body.subarray(at, at + SMALL_REPLY)));
        at += SMALL_REPLY;
      },
      cancel() { clearTimeout(timer); release(); },
    }, { highWaterMark: 0 });
    return new Response(stream, { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(size) } });
  }

  app.delete('/v1/groups/:gid/boxes/:did', async (c) => {
    if (!ids(c, 'gid', 'did')) return d.err(c, 400, 'bad-request');
    const auth = await authorise(c); if (auth !== 'ok') return auth;
    await d.groups.deleteBox(c.req.param('gid')!, c.req.param('did')!);
    d.downloads.forget(boxKey(c.req.param('gid')!, c.req.param('did')!));
    return c.body(null, 204);
  });

  app.post('/v1/groups/:gid/rekey', async (c) => {
    if (!ids(c, 'gid')) return d.err(c, 400, 'bad-request');
    const th = token(c);
    if (!th) return d.err(c, 403, 'denied');
    // A group the relay doesn't have (it lost its data) is created already retired; one it has
    // needs its own token, checked before any work
    const gid = c.req.param('gid')!;
    const exists = await d.groups.group(gid);
    if (exists && !sameHash(exists.tokenHash, th)) return d.err(c, 403, 'denied');
    // Creating one is a new group: the same switch, and the same database cap, as a first box
    if (!exists && (d.cfg().newGroupsPaused || (await d.groups.sizeBytes()) > d.maxDbBytes())) return d.err(c, 429, 'busy');
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
      // Exactly what sealRekey makes, and not text: a key's slot holds nothing else
      const sealed = Buffer.from(e.sealed, 'base64');
      if (sealed.length !== REKEY_BYTES || mostlyText(sealed)) { d.metrics.refused.bad_rekey++; return d.err(c, 400, 'bad-request'); }
      map.set(did, { sealed, ackHash: Buffer.from(e.ack, 'base64') });
    }
    const fresh = () => { for (const did of map.keys()) d.downloads.forget(rekeyKey(gid, did)); };
    if (!exists && (await d.groups.createRetired(gid, th, map, today())) === 'ok') { fresh(); return c.body(null, 204); }
    // Created meanwhile by someone else: only its own token may move it
    const now = await d.groups.group(gid);
    if (!now || !sameHash(now.tokenHash, th)) return d.err(c, now ? 403 : 404, now ? 'denied' : 'not-found');
    const out = await d.groups.rekey(gid, map, today());
    if (!out) return d.err(c, 404, 'not-found');
    if (out === 'moved') return d.err(c, 409, 'moved');
    fresh();
    return c.body(null, 204);
  });

  app.get('/v1/groups/:gid/rekey/:did', async (c) => {
    if (!ids(c, 'gid', 'did')) return d.err(c, 400, 'bad-request');
    const auth = await authorise(c); if (auth !== 'ok') return auth;
    const gid = c.req.param('gid')!, did = c.req.param('did')!;
    // A computer fetches its new key a few times at most (until it proves it opened it). Counted
    // before the read, so fetches at once can't all pass the check
    if (d.downloads.count(rekeyKey(gid, did), 0) >= d.cfg().maxBoxDownloads) { d.metrics.limited.rekey++; return d.err(c, 429, 'busy'); }
    d.downloads.add(rekeyKey(gid, did), 0);
    const sealed = await d.groups.getRekey(gid, did, today());
    if (!sealed) return d.err(c, 404, 'not-found');
    return c.json({ sealed: sealed.toString('base64') });
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
