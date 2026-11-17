// packages/mailbox/src/server/sync-routes.test.ts
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BOX_PAD, CHALLENGE_HEADER, sealBox, POW_HEADER, VERSION_HEADER, deriveGroup, newDeviceId, powBitsFor, powInput, solvePow } from '../protocol/index.js';
import { createApp } from './app.js';
import { DEFAULTS } from './settings.js';
import { MemoryGroupStore } from './groups.js';

const V = '0.17.0';
function setup(over: Parameters<typeof createApp>[0] = {}) {
  let t = Date.UTC(2026, 10, 16, 12);
  const { app } = createApp({ powBits: 4, now: () => t, ...over });
  const call = async (method: string, path: string, opts: { token?: string; body?: unknown; pow?: boolean } = {}) => {
    const text = opts.body === undefined ? '' : JSON.stringify(opts.body);
    const headers: Record<string, string> = { [VERSION_HEADER]: V };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (text) headers['content-type'] = 'application/json';
    if (opts.pow) {
      const hello = await app.fetch(new Request('http://x/v1/hello', { headers: { [VERSION_HEADER]: V } }));
      const challenge = hello.headers.get(CHALLENGE_HEADER)!;
      const nonce = solvePow(powInput(path.split('?')[0], text, challenge, V), powBitsFor(4, Buffer.byteLength(text)));
      headers[POW_HEADER] = `${challenge}.${nonce}`;
    }
    return app.fetch(new Request(`http://x${path}`, { method, headers, body: text || undefined }));
  };
  return { call, advance: (ms: number) => { t += ms; } };
}

const group = () => { const g = deriveGroup(randomBytes(32)); return { ...g, did: newDeviceId() }; };
/** A rekey entry: the sealed key and the hash of a pick-up proof */
const withAck = (sealedKey: string) => ({ sealed: sealedKey, ack: randomBytes(32).toString('base64') });
/** Random bytes stand in for a sealed box (the app pads boxes to 16 KB steps) */
const sealed = (n = BOX_PAD) => randomBytes(n).toString('base64');

describe('sync routes', () => {
  it('first box creates the group; list returns it; since filters', async () => {
    const { call } = setup(); const g = group();
    const put = await call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: sealed() }, pow: true });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ seq: 1 });
    const all = await (await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).json();
    expect(all).toMatchObject({ seq: 1, computers: [{ id: g.did, seq: 1 }], boxes: [{ id: g.did, seq: 1 }] });
    const none = await (await call('GET', `/v1/groups/${g.groupId}/boxes?since=1`, { token: g.accessToken })).json();
    expect(none.boxes).toEqual([]);
  });

  it('a write without proof is refused before anything is stored', async () => {
    const { call } = setup(); const g = group();
    const r = await call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: sealed() } });
    expect(r.status).toBe(428);
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).status).toBe(404);
  });

  it('a wrong or missing token is refused', async () => {
    const { call } = setup(); const g = group();
    await call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: sealed() }, pow: true });
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: group().accessToken })).status).toBe(403);
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`)).status).toBe(403);
    const put = await call('PUT', `/v1/groups/${g.groupId}/boxes/${newDeviceId()}`, { token: group().accessToken, body: { sealed: sealed() }, pow: true });
    expect(put.status).toBe(403);
  });

  it('malformed ids, since and bodies are bad requests', async () => {
    const { call } = setup(); const g = group();
    expect((await call('GET', `/v1/groups/nothex/boxes?since=0`, { token: g.accessToken })).status).toBe(400);
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=-1`, { token: g.accessToken })).status).toBe(400);
    const r = await call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: 'not base64!' }, pow: true });
    expect(r.status).toBe(400);
  });

  it('refuses boxes that are not padded and sealed like the app\'s; a real one is stored', async () => {
    const { call } = setup(); const g = group();
    const put = (bytes: Buffer) => call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: bytes.toString('base64') }, pow: true });
    expect((await put(Buffer.from('readable text, not sealed '.repeat(630).padEnd(BOX_PAD)))).status).toBe(400);
    expect((await put(randomBytes(BOX_PAD + 1))).status).toBe(400);    // not in 16 KB steps
    expect((await put(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), randomBytes(BOX_PAD - 4)]))).status).toBe(400);   // a zip
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).status).toBe(404);   // nothing stored
    expect((await put(sealBox(g.encKey, g.groupId, g.did, Buffer.from('{"v":1}')))).status).toBe(200);
  });

  it('a box over the limit is too big', async () => {
    const { call } = setup(); const g = group();
    const r = await call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: sealed(1024 * 1024 + 16) }, pow: true });
    expect(r.status).toBe(413);
  });

  it('rekey: old group moved, late writes refused, keys per computer', async () => {
    const { call } = setup(); const g = group(); const other = newDeviceId(), removed = newDeviceId();
    for (const d of [g.did, other, removed]) await call('PUT', `/v1/groups/${g.groupId}/boxes/${d}`, { token: g.accessToken, body: { sealed: sealed() }, pow: true });
    const key = randomBytes(140).toString('base64');
    const proof = randomBytes(32);
    const ack = createHash('sha256').update(proof).digest().toString('base64');
    expect((await call('POST', `/v1/groups/${g.groupId}/rekey`, { token: g.accessToken, body: { keys: { [other]: { sealed: key, ack } } }, pow: true })).status).toBe(204);
    expect(await (await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).json()).toEqual({ moved: true, waiting: 1 });
    const late = await call('PUT', `/v1/groups/${g.groupId}/boxes/${removed}`, { token: g.accessToken, body: { sealed: sealed() }, pow: true });
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: 'moved' });
    expect(await (await call('GET', `/v1/groups/${g.groupId}/rekey/${other}`, { token: g.accessToken })).json()).toEqual({ sealed: key });
    expect((await call('GET', `/v1/groups/${g.groupId}/rekey/${removed}`, { token: g.accessToken })).status).toBe(404);
    // Fetching isn't picking up; only the proof of the new key is (a holder of the old token can't fake it)
    expect(await (await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).json()).toEqual({ moved: true, waiting: 1 });
    expect((await call('POST', `/v1/groups/${g.groupId}/rekey/${other}/ack`, { token: g.accessToken, body: { proof: randomBytes(32).toString('base64') } })).status).toBe(403);
    expect((await call('POST', `/v1/groups/${g.groupId}/rekey/${other}/ack`, { token: g.accessToken, body: { proof: proof.toString('base64') } })).status).toBe(204);
    expect(await (await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).json()).toEqual({ moved: true, waiting: 0 });
  });

  it('retiring a group the relay lost creates it already retired; it then needs its own token', async () => {
    const { call } = setup(); const g = group(); const other = newDeviceId();
    const key = randomBytes(140).toString('base64');
    expect((await call('POST', `/v1/groups/${g.groupId}/rekey`, { token: g.accessToken, body: { keys: { [other]: { sealed: key, ack: randomBytes(32).toString('base64') } } }, pow: true })).status).toBe(204);
    expect(await (await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).json()).toEqual({ moved: true, waiting: 1 });
    expect((await call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: sealed() }, pow: true })).status).toBe(409);
    expect((await call('POST', `/v1/groups/${g.groupId}/rekey`, { token: group().accessToken, body: { keys: {} }, pow: true })).status).toBe(403);
  });

  it('"no new groups" also refuses a retired group the relay does not have (same gate as a first box)', async () => {
    const { call } = setup({ newGroupsPaused: true }); const g = group();
    const r = await call('POST', `/v1/groups/${g.groupId}/rekey`, { token: g.accessToken, body: { keys: {} }, pow: true });
    expect(r.status).toBe(429);
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).status).toBe(404);
  });

  it('the database id is the same on every ask, and needs no token', async () => {
    const { call } = setup();
    const a = await (await call('GET', '/v1/sync/epoch')).json();
    expect(a.epoch).toMatch(/^[0-9a-f]{32}$/);
    expect(await (await call('GET', '/v1/sync/epoch')).json()).toEqual(a);
  });

  it('leave deletes the box; the last one takes the group', async () => {
    const { call } = setup(); const g = group();
    await call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: sealed() }, pow: true });
    expect((await call('DELETE', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken })).status).toBe(204);
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).status).toBe(404);
  });

  it('switches: sync paused refuses writes; new groups paused refuses only new groups', async () => {
    const g = group();
    const paused = setup({ syncPaused: true });
    expect((await paused.call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: sealed() }, pow: true })).status).toBe(429);
    const noNew = setup({ newGroupsPaused: true });
    expect((await noNew.call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: sealed() }, pow: true })).status).toBe(429);
  });

  it('an old app is told to update', async () => {
    const { app } = createApp({ minVersion: '0.17.0' });
    const r = await app.fetch(new Request(`http://x/v1/groups/${'a'.repeat(32)}/boxes?since=0`, { headers: { [VERSION_HEADER]: '0.16.0' } }));
    expect(r.status).toBe(426);
  });
});

describe('sync routes: guards (lens 7)', () => {
  const put = (call: ReturnType<typeof setup>['call'], g: ReturnType<typeof group>, did = g.did) =>
    call('PUT', `/v1/groups/${g.groupId}/boxes/${did}`, { token: g.accessToken, body: { sealed: sealed() }, pow: true });

  it('"no new groups" still lets an existing group write', async () => {
    const groups = new MemoryGroupStore(); const g = group();
    expect((await put(setup({ groups }).call, g)).status).toBe(200);
    expect((await put(setup({ groups, newGroupsPaused: true }).call, g)).status).toBe(200);
  });

  it('leave needs the group token: a stranger cannot delete a box', async () => {
    const { call } = setup(); const g = group();
    await put(call, g);
    expect((await call('DELETE', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: group().accessToken })).status).toBe(403);
    expect((await call('DELETE', `/v1/groups/${g.groupId}/boxes/${g.did}`)).status).toBe(403);
    expect((await (await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).json()).boxes).toHaveLength(1);
  });

  it('a new key needs the group token, and a refused fetch does not count as picked up', async () => {
    const { call } = setup(); const g = group(); const other = newDeviceId();
    await put(call, g); await put(call, g, other);
    expect((await call('POST', `/v1/groups/${g.groupId}/rekey`, { token: g.accessToken, body: { keys: { [other]: withAck(sealed(140)) } }, pow: true })).status).toBe(204);
    expect((await call('GET', `/v1/groups/${g.groupId}/rekey/${other}`, { token: group().accessToken })).status).toBe(403);
    expect((await call('GET', `/v1/groups/${g.groupId}/rekey/${other}`)).status).toBe(403);
    expect(await (await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).json()).toEqual({ moved: true, waiting: 1 });
  });

  it('rekey refuses a key without its pick-up hash', async () => {
    const { call } = setup(); const g = group();
    await put(call, g);
    expect((await call('POST', `/v1/groups/${g.groupId}/rekey`, { token: g.accessToken, body: { keys: { [newDeviceId()]: sealed(140) } }, pow: true })).status).toBe(400);
  });

  it('rekey refuses too many keys, bad computer ids and oversized keys; sync paused refuses it', async () => {
    const { call } = setup(); const g = group();
    await put(call, g);
    const rekey = (keys: Record<string, string>, c = call) => c('POST', `/v1/groups/${g.groupId}/rekey`, { token: g.accessToken, body: { keys: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, withAck(v)])) }, pow: true });
    expect((await rekey(Object.fromEntries(Array.from({ length: 11 }, () => [newDeviceId(), sealed(140)])))).status).toBe(400);
    expect((await rekey({ 'not-a-device': sealed(140) })).status).toBe(400);
    expect((await rekey({ [newDeviceId()]: sealed(600) })).status).toBe(400);
    expect((await (await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).json()).boxes).toHaveLength(1);
    expect((await rekey({}, setup({ syncPaused: true }).call)).status).toBe(429);
  });

  it('a since that is not a number is a bad request', async () => {
    const { call } = setup(); const g = group();
    await put(call, g);
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=abc`, { token: g.accessToken })).status).toBe(400);
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=1.5`, { token: g.accessToken })).status).toBe(400);
  });

  it('"sync paused" also stops list reads (review C1)', async () => {
    const { call } = setup({ syncPaused: true }); const g = group();
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).status).toBe(429);
  });

  it('large list replies share a byte budget held until they are sent; small ones are always served (review C1, security)', async () => {
    const { call } = setup({ listInflightBytes: 100_000 }); const g = group();
    await call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: sealed(4 * BOX_PAD) }, pow: true });
    const first = await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken });   // ~87 KB, not read yet
    expect(first.status).toBe(200);
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).status).toBe(429);   // budget held by the unread reply
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=1`, { token: g.accessToken })).status).toBe(200);   // a small "anything new?" still works
    await first.text();                                                                                                 // read: the budget comes back
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).status).toBe(200);
  });

  it('one group can hold only a few replies at once (so a few groups cannot hold everyone else\'s) (security)', async () => {
    const { call } = setup(); const g = group();
    await put(call, g);
    const held = [];
    for (let i = 0; i < 4; i++) held.push(await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken }));
    expect(held.every((r) => r.status === 200)).toBe(true);
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).status).toBe(429);
    await held[0].text();
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).status).toBe(200);
  });

  it('small replies have their own budget, held until sent (security)', async () => {
    const { call } = setup({ smallListInflightBytes: 30_000 }); const g = group(), g2 = group();
    await put(call, g); await put(call, g2);
    const first = await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken });
    expect((await call('GET', `/v1/groups/${g2.groupId}/boxes?since=0`, { token: g2.accessToken })).status).toBe(429);
    await first.text();
    expect((await call('GET', `/v1/groups/${g2.groupId}/boxes?since=0`, { token: g2.accessToken })).status).toBe(200);
  });

  it('a reply not read in time is aborted, and only then is its budget given back (security)', async () => {
    const { call } = setup({ listInflightBytes: 100_000, listHoldMs: 30 }); const g = group();
    await call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: sealed(4 * BOX_PAD) }, pow: true });
    const slow = await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken });
    await new Promise((r) => setTimeout(r, 60));
    await expect(slow.text()).rejects.toThrow();   // the memory went with it
    expect((await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).status).toBe(200);
  });

  it('a small reply not read within 15 seconds is aborted (slow readers cannot hold the small budget for long) (security)', async () => {
    const { call } = setup({ smallListInflightBytes: 30_000, smallListHoldMs: 30 }); const g = group(), g2 = group();
    await put(call, g); await put(call, g2);
    const slow = await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken });
    await new Promise((r) => setTimeout(r, 60));
    await expect(slow.text()).rejects.toThrow();
    expect((await call('GET', `/v1/groups/${g2.groupId}/boxes?since=0`, { token: g2.accessToken })).status).toBe(200);
  });

  it('box uploads in flight are limited before any proof is checked (review C2)', async () => {
    const { call } = setup({ syncInflightBytes: 100 }); const g = group();
    const r = await call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: sealed(200) } });
    expect(r.status).toBe(429);
  });

  it('over the database size cap, uploads are refused busy (review C3)', async () => {
    const { call } = setup({ syncMaxDbBytes: 10 }); const g = group();
    expect((await call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: sealed() }, pow: true })).status).toBe(200);
    const g2 = group();
    expect((await call('PUT', `/v1/groups/${g2.groupId}/boxes/${g2.did}`, { token: g2.accessToken, body: { sealed: sealed() }, pow: true })).status).toBe(429);
  });

  it('sync uploads have their own proof-of-work level: busy sync does not slow "Get a code" (review C5)', async () => {
    const { call } = setup({ busyPerMinute: 1 }); const g = group();
    for (let i = 0; i < 4; i++) await put(call, g, newDeviceId());
    const hello = await (await call('GET', '/v1/hello')).json();
    expect(hello.bits).toBe(4);
  });
});

describe('sync routes: one version of a box is downloaded only so many times', () => {
  const limited = (max: number) => setup({ settings: () => ({ ...DEFAULTS, powBits: 4, minVersion: V, maxBoxDownloads: max }) });
  const putBox = (call: ReturnType<typeof setup>['call'], g: ReturnType<typeof group>, did = g.did) =>
    call('PUT', `/v1/groups/${g.groupId}/boxes/${did}`, { token: g.accessToken, body: { sealed: sealed() }, pow: true });
  const list = async (call: ReturnType<typeof setup>['call'], g: ReturnType<typeof group>, since = 0) => {
    const r = await call('GET', `/v1/groups/${g.groupId}/boxes?since=${since}`, { token: g.accessToken });
    if (r.status === 200) await r.text();
    return r.status;
  };

  it('a handed-around group stops serving that version; "anything new?" still works; a new version is served again', async () => {
    const { call } = limited(3); const g = group();
    expect((await putBox(call, g)).status).toBe(200);
    for (let i = 0; i < 3; i++) expect(await list(call, g)).toBe(200);
    expect(await list(call, g)).toBe(429);       // the 4th download of the same version
    expect(await list(call, g, 1)).toBe(200);    // nothing new since seq 1: no box in the reply, not counted
    expect((await putBox(call, g)).status).toBe(200);
    expect(await list(call, g, 1)).toBe(200);    // the new version, downloaded afresh
  });

  it('a full group syncing all day never reaches the default limit', async () => {
    const { call } = setup(); const g = group();
    const dids = Array.from({ length: 10 }, () => newDeviceId());
    const since = new Map(dids.map((x) => [x, 0]));
    for (const x of dids) await putBox(call, g, x);
    // Every computer pushes in turn; each one reads what changed since its last read, twice (a retry)
    for (let round = 0; round < 6; round++) {
      for (const pusher of dids) {
        expect((await putBox(call, g, pusher)).status).toBe(200);
        for (const reader of dids) {
          if (reader === pusher) continue;
          let seq = 0;
          for (let i = 0; i < 2; i++) {
            const r = await call('GET', `/v1/groups/${g.groupId}/boxes?since=${since.get(reader)}`, { token: g.accessToken });
            expect(r.status).toBe(200);
            seq = (await r.json()).seq;
          }
          since.set(reader, seq);
        }
      }
    }
  });
});
