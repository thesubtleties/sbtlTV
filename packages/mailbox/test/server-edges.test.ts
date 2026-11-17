import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp, type MailboxOptions } from '../src/server/app';
import { DEFAULTS, type Settings } from '../src/server/settings';
import { DROP_TTL_MS, KNOCK_TTL_MS, POW_HEADER, VERSION_HEADER, powBitsFor } from '../src/protocol';
import { challengeOf, proof } from './support';

const BITS = 4;
const V = '0.17.0';
/** n bytes that look sealed (random-looking, the same for the same fill), as base64 */
const b64 = (n: number, fill = 1) => {
  const out = Buffer.alloc(n);
  for (let i = 0; i * 32 < n; i++) createHash('sha256').update(`${fill}|${i}`).digest().copy(out, i * 32);
  return out.toString('base64');
};

function server(opts: MailboxOptions = {}) {
  let t = 1_800_000_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const { app, store } = createApp({ now: clock.now, powBits: BITS, minVersion: V, ...opts });
  /** pow: true = solved at the size-based level; a number = exactly that many bits; challenge overrides the server's. */
  const call = async (method: string, path: string, body?: unknown, o: { pow?: boolean | number; challenge?: string; xff?: string } = {}) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json', [VERSION_HEADER]: V };
    if (o.xff) headers['x-forwarded-for'] = o.xff;
    if (o.pow !== undefined && o.pow !== false) {
      const bits = o.pow === true ? powBitsFor(BITS, Buffer.byteLength(text)) : o.pow;
      headers[POW_HEADER] = await proof(app, path, text, bits, V, o.pow !== true, o.challenge);
    }
    const res = await app.fetch(new Request(`http://mailbox${path}`, { method, headers, body: text || undefined }));
    const json = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    return { status: res.status, json, headers: res.headers };
  };
  /** A knock that is rung and revealed, ready for a drop. */
  const ready = async (fill = 1) => {
    const k = await call('POST', '/v1/knock', { commitment: b64(32, fill) }, { pow: true });
    const ring = await call('POST', '/v1/ring', { code: k.json.code }, { pow: true });
    await call('POST', `/v1/ring/${ring.json.ticket}/key`, { giverKey: b64(32, fill) });
    await call('POST', `/v1/knock/${k.json.id}/reveal`, { receiverKey: b64(32), r: b64(16) });
    return { id: k.json.id as string, ticket: ring.json.ticket as string };
  };
  return { app, store, clock, call, ready };
}

describe('mailbox server: expiry, sweeping and memory', () => {
  it('a drop nobody picks up gives its memory back when it runs out', async () => {
    const { call, clock, ready } = server({ maxStoredBytes: 150 });
    const a = await ready(1);
    expect((await call('PUT', `/v1/ring/${a.ticket}/drop`, { sealed: b64(100, 1) }, { pow: true })).status).toBe(204);
    clock.advance(DROP_TTL_MS + 1);
    // Nobody touches knock a again: only the sweep can free its bytes
    const b = await ready(2);
    expect((await call('PUT', `/v1/ring/${b.ticket}/drop`, { sealed: b64(100, 2) }, { pow: true })).status).toBe(204);
  });

  it('holds at most maxActive knocks; expired ones make room again', async () => {
    const { call, clock } = server({ maxActive: 2 });
    expect((await call('POST', '/v1/knock', { commitment: b64(32, 1) }, { pow: true })).status).toBe(201);
    expect((await call('POST', '/v1/knock', { commitment: b64(32, 2) }, { pow: true })).status).toBe(201);
    expect((await call('POST', '/v1/knock', { commitment: b64(32, 3) }, { pow: true })).json).toEqual({ error: 'busy' });
    clock.advance(KNOCK_TTL_MS + 1);
    expect((await call('POST', '/v1/knock', { commitment: b64(32, 4) }, { pow: true })).status).toBe(201);
  });

  it('a cancelled knock is visible as cancelled for five minutes, then gone, and keeps no keys', async () => {
    const { call, clock, ready, store } = server();
    const k = await ready();
    await call('POST', `/v1/ring/${k.ticket}/cancel`);
    const held = store.byIdLive(k.id)!;
    expect([held.giverKey, held.receiverKey, held.r, held.sealed]).toEqual([undefined, undefined, undefined, undefined]);
    clock.advance(5 * 60_000 - 1_000);
    expect((await call('GET', `/v1/knock/${k.id}`)).json).toEqual({ status: 'cancelled' });
    expect((await call('GET', `/v1/ring/${k.ticket}`)).json).toEqual({ status: 'cancelled' });
    clock.advance(2_000);
    expect((await call('GET', `/v1/knock/${k.id}`)).status).toBe(404);
    expect((await call('GET', `/v1/ring/${k.ticket}`)).status).toBe(404);
  });

  it('a received drop is unreachable by the receiver id; the giver sees gone; a late cancel changes nothing', async () => {
    const { call, ready } = server();
    const k = await ready();
    await call('PUT', `/v1/ring/${k.ticket}/drop`, { sealed: b64(100) }, { pow: true });
    await call('GET', `/v1/knock/${k.id}/drop`);
    await call('POST', `/v1/knock/${k.id}/receipt`, { ok: true });
    expect((await call('GET', `/v1/knock/${k.id}`)).status).toBe(404);
    await call('POST', `/v1/ring/${k.ticket}/cancel`);
    expect((await call('GET', `/v1/ring/${k.ticket}`)).json).toEqual({ status: 'gone' });
  });
});

describe('mailbox server: proof-of-work edges', () => {
  it('proofs need a challenge from this server, at most 15 minutes old: none can be made ahead', async () => {
    const { app, call, clock } = server();
    const ch = await challengeOf(app);
    expect((await call('POST', '/v1/knock', { commitment: b64(32, 1) }, { pow: true, challenge: ch })).status).toBe(201);
    const [stamp] = ch.split('-');
    expect((await call('POST', '/v1/knock', { commitment: b64(32, 2) }, { pow: true, challenge: `${stamp}-${'A'.repeat(22)}` })).status).toBe(428);
    const later = (Number.parseInt(stamp, 36) + 60 * 60_000).toString(36);
    expect((await call('POST', '/v1/knock', { commitment: b64(32, 3) }, { pow: true, challenge: `${later}-${ch.split('-')[1]}` })).status).toBe(428);
    expect((await call('POST', '/v1/knock', { commitment: b64(32, 4) }, { pow: true, challenge: 'nonsense' })).status).toBe(428);
    clock.advance(15 * 60_000 + 1);
    expect((await call('POST', '/v1/knock', { commitment: b64(32, 5) }, { pow: true, challenge: ch })).status).toBe(428);
    const other = createApp({ now: clock.now, powBits: BITS, minVersion: V }).app;   // another server (or a restart)
    expect((await call('POST', '/v1/knock', { commitment: b64(32, 6) }, { pow: true, challenge: await challengeOf(other) })).status).toBe(428);
  });
  it('a refused proof says how much work the request needs', async () => {
    const { call, ready } = server();
    const k = await ready();
    const body = { sealed: b64(1024 * 1024) };
    const res = await call('PUT', `/v1/ring/${k.ticket}/drop`, body, { pow: BITS });
    expect(res.status).toBe(428);
    expect(res.headers.get('x-sbtltv-pow-bits')).toBe(String(powBitsFor(BITS, Buffer.byteLength(JSON.stringify(body)))));
  });

  it('proven writes raise the level at once, and for a minute after the rise the old level still counts', async () => {
    const settings: Settings = { ...DEFAULTS, powBits: BITS, minVersion: V, busyPerMinute: 2 };
    const { call, clock } = server({ settings: () => settings });
    for (let i = 1; i <= 3; i++) expect((await call('POST', '/v1/knock', { commitment: b64(32, i) }, { pow: true })).status).toBe(201);
    const hello = await call('GET', '/v1/hello');
    expect(hello.json.bits).toBe(BITS + 1);
    expect(hello.headers.get('x-sbtltv-pow-level')).toBe(String(BITS + 1));
    // Exactly the old level: still accepted during the grace minute...
    expect((await call('POST', '/v1/knock', { commitment: b64(32, 7) }, { pow: BITS })).status).toBe(201);
    clock.advance(60_000);
    // ...and refused after it
    expect((await call('POST', '/v1/knock', { commitment: b64(32, 8) }, { pow: BITS })).status).toBe(428);
    expect((await call('POST', '/v1/knock', { commitment: b64(32, 9) }, { pow: BITS + 1 })).status).toBe(201);
  });


;
});

describe('mailbox server: the large-drop budget gives back what a failed drop took', () => {
  it('drops refused for missing work do not use up the hourly budget', async () => {
    const { call, ready } = server({ largeDropBytesPerHour: 400 * 1024 });
    const a = await ready(1);
    // Large drops with no proof at all: free to send, so they must not hold budget
    for (let i = 0; i < 3; i++) expect((await call('PUT', `/v1/ring/${a.ticket}/drop`, { sealed: b64(300 * 1024, 1) })).status).toBe(428);
    expect((await call('PUT', `/v1/ring/${a.ticket}/drop`, { sealed: b64(300 * 1024, 1) }, { pow: true })).status).toBe(204);
  }, 60_000);

  it('a large drop refused for memory gives its budget back', async () => {
    // "Large" starts at 16 KB, so the filler counts too: 100 + 300 (a, refused) + 300 (b) only fits 600 KB if a gave its share back
    const { call, ready } = server({ largeDropBytesPerHour: 600 * 1024, maxStoredBytes: 450 * 1024 });
    const filler = await ready(1);
    const a = await ready(2);
    const b = await ready(3);
    // A small drop (not large) holds ~136 KB of the 450 KB memory
    expect((await call('PUT', `/v1/ring/${filler.ticket}/drop`, { sealed: b64(100 * 1024, 1) }, { pow: true })).status).toBe(204);
    // 300 KB (400 KB as base64) fits the hourly budget but not the memory left: busy
    expect((await call('PUT', `/v1/ring/${a.ticket}/drop`, { sealed: b64(300 * 1024, 2) }, { pow: true })).json).toEqual({ error: 'busy' });
    await call('GET', `/v1/knock/${filler.id}/drop`);   // memory free again
    // Had the refused drop kept its 300 KB of the 400 KB budget, this one would be busy too
    expect((await call('PUT', `/v1/ring/${b.ticket}/drop`, { sealed: b64(300 * 1024, 3) }, { pow: true })).status).toBe(204);
  }, 60_000);
});

describe('mailbox server: after the review', () => {
  it('the level rises within the busy minute, not only after it', async () => {
    const settings: Settings = { ...DEFAULTS, powBits: BITS, minVersion: V, busyPerMinute: 2 };
    const { call } = server({ settings: () => settings });
    for (let i = 1; i <= 3; i++) await call('POST', '/v1/knock', { commitment: b64(32, i) }, { pow: true });
    expect((await call('GET', '/v1/hello')).json.bits).toBe(BITS + 1);
  });

  it('a claimed code gives the knock another ten minutes for the words and the work', async () => {
    const { call, clock } = server();
    const k = await call('POST', '/v1/knock', { commitment: b64(32, 1) }, { pow: true });
    clock.advance(9 * 60_000);
    const ring = await call('POST', '/v1/ring', { code: k.json.code }, { pow: true });
    clock.advance(6 * 60_000);
    expect((await call('GET', `/v1/ring/${ring.json.ticket}`)).json.status).toBe('claimed');
  });

  it('a drop body announced too big is refused before it is read', async () => {
    const { app, ready } = server();
    const r = await ready();
    const res = await app.fetch(new Request(`http://mailbox/v1/ring/${r.ticket}/drop`, { method: 'PUT', headers: { [VERSION_HEADER]: V, 'content-length': String(10 * 1024 * 1024) }, body: 'x' }));
    expect(res.status).toBe(413);
  });

  it('the receiver confirms what it got: the giver hears "received" only then, or that it could not be read', async () => {
    const { call, ready } = server();
    const a = await ready(1);
    await call('PUT', `/v1/ring/${a.ticket}/drop`, { sealed: b64(100, 1) }, { pow: true });
    await call('GET', `/v1/knock/${a.id}/drop`);
    expect((await call('GET', `/v1/ring/${a.ticket}`)).json.status).toBe('picked');
    expect((await call('POST', `/v1/knock/${a.id}/receipt`, { ok: true })).status).toBe(204);
    expect((await call('GET', `/v1/ring/${a.ticket}`)).json.status).toBe('gone');
    const b = await ready(2);
    await call('PUT', `/v1/ring/${b.ticket}/drop`, { sealed: b64(100, 2) }, { pow: true });
    await call('GET', `/v1/knock/${b.id}/drop`);
    await call('POST', `/v1/knock/${b.id}/receipt`, { ok: false });
    expect((await call('GET', `/v1/ring/${b.ticket}`)).json.status).toBe('unreadable');
  });

  it('a large drop starts at 16 KB by default', () => {
    expect(DEFAULTS.largeDropKb).toBe(16);
  });
});
