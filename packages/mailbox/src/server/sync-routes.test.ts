// packages/mailbox/src/server/sync-routes.test.ts
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHALLENGE_HEADER, POW_HEADER, VERSION_HEADER, deriveGroup, newDeviceId, powBitsFor, powInput, solvePow } from '../protocol/index.js';
import { createApp } from './app.js';

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
const sealed = (n = 64) => randomBytes(n).toString('base64');

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

  it('a box over the limit is too big', async () => {
    const { call } = setup(); const g = group();
    const r = await call('PUT', `/v1/groups/${g.groupId}/boxes/${g.did}`, { token: g.accessToken, body: { sealed: sealed(1024 * 1024 + 16) }, pow: true });
    expect(r.status).toBe(413);
  });

  it('rekey: old group moved, late writes refused, keys per computer', async () => {
    const { call } = setup(); const g = group(); const other = newDeviceId(), removed = newDeviceId();
    for (const d of [g.did, other, removed]) await call('PUT', `/v1/groups/${g.groupId}/boxes/${d}`, { token: g.accessToken, body: { sealed: sealed() }, pow: true });
    const key = randomBytes(140).toString('base64');
    expect((await call('POST', `/v1/groups/${g.groupId}/rekey`, { token: g.accessToken, body: { keys: { [other]: key } }, pow: true })).status).toBe(204);
    expect(await (await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).json()).toEqual({ moved: true, waiting: 1 });
    const late = await call('PUT', `/v1/groups/${g.groupId}/boxes/${removed}`, { token: g.accessToken, body: { sealed: sealed() }, pow: true });
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: 'moved' });
    expect(await (await call('GET', `/v1/groups/${g.groupId}/rekey/${other}`, { token: g.accessToken })).json()).toEqual({ sealed: key });
    expect((await call('GET', `/v1/groups/${g.groupId}/rekey/${removed}`, { token: g.accessToken })).status).toBe(404);
    expect(await (await call('GET', `/v1/groups/${g.groupId}/boxes?since=0`, { token: g.accessToken })).json()).toEqual({ moved: true, waiting: 0 });
  });

  it('retiring a group the relay lost creates it already retired; it then needs its own token', async () => {
    const { call } = setup(); const g = group(); const other = newDeviceId();
    const key = randomBytes(140).toString('base64');
    expect((await call('POST', `/v1/groups/${g.groupId}/rekey`, { token: g.accessToken, body: { keys: { [other]: key } }, pow: true })).status).toBe(204);
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
