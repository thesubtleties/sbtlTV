import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app';
import { POW_HEADER, VERSION_HEADER, powInput, solvePow, KNOCK_TTL_MS, DROP_TTL_MS } from '../src/protocol';

const BITS = 4;
function setup() {
  let t = 1_800_000_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const { app } = createApp({ now: clock.now, powBits: BITS, minVersion: '0.17.0' });
  const call = async (method: string, path: string, body?: unknown, opts: { pow?: boolean; version?: string } = {}) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    const version = opts.version ?? '0.17.0';
    const headers: Record<string, string> = { 'content-type': 'application/json', [VERSION_HEADER]: version };
    if (opts.pow) {
      const minute = Math.floor(clock.now() / 60_000);
      headers[POW_HEADER] = `${minute}.${solvePow(powInput(path, text, minute, version), BITS)}`;
    }
    const res = await app.fetch(new Request(`http://mailbox${path}`, { method, headers, body: text || undefined }));
    const json = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    return { status: res.status, json };
  };
  return { clock, call };
}
const b64 = (n: number, fill = 1) => Buffer.alloc(n, fill).toString('base64');

describe('mailbox server', () => {
  it('runs a full knock: create, ring, reveal, drop, one pickup', async () => {
    const { call } = setup();
    const k = await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    expect(k.status).toBe(201);
    expect(await call('GET', `/v1/knock/${k.json.id}`)).toMatchObject({ json: { status: 'waiting' } });

    const ring = await call('POST', '/v1/ring', { code: k.json.code, giverKey: b64(32, 2) }, { pow: true });
    expect(ring.status).toBe(201);
    expect(ring.json.commitment).toBe(b64(32));
    expect((await call('GET', `/v1/knock/${k.json.id}`)).json).toEqual({ status: 'rung', giverKey: b64(32, 2) });

    expect((await call('POST', `/v1/knock/${k.json.id}/reveal`, { receiverKey: b64(32, 3), r: b64(16, 4) })).status).toBe(204);
    expect((await call('GET', `/v1/ring/${ring.json.ticket}`)).json).toEqual({ status: 'revealed', receiverKey: b64(32, 3), r: b64(16, 4) });

    expect((await call('PUT', `/v1/ring/${ring.json.ticket}/drop`, { sealed: b64(100, 5) }, { pow: true })).status).toBe(204);
    expect((await call('GET', `/v1/knock/${k.json.id}`)).json.status).toBe('dropped');
    const pick = await call('GET', `/v1/knock/${k.json.id}/drop`);
    expect(pick.json).toEqual({ sealed: b64(100, 5), giverKey: b64(32, 2) });
    expect((await call('GET', `/v1/knock/${k.json.id}/drop`)).status).toBe(404);   // gone after pickup
    expect((await call('GET', `/v1/ring/${ring.json.ticket}`)).json.status).toBe('gone');
  });

  it('a code rings once; a wrong code is just not found', async () => {
    const { call } = setup();
    const k = await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    expect((await call('POST', '/v1/ring', { code: k.json.code, giverKey: b64(32) }, { pow: true })).status).toBe(201);
    expect((await call('POST', '/v1/ring', { code: k.json.code, giverKey: b64(32, 3) }, { pow: true })).json).toEqual({ error: 'not-found' });
    expect((await call('POST', '/v1/ring', { code: 'ZZZZZZZZ', giverKey: b64(32) }, { pow: true })).json).toEqual({ error: 'not-found' });
  });

  it('codes expire after 10 minutes; drops after 24 hours', async () => {
    const { call, clock } = setup();
    const k = await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    clock.advance(KNOCK_TTL_MS + 1);
    expect((await call('POST', '/v1/ring', { code: k.json.code, giverKey: b64(32) }, { pow: true })).status).toBe(404);

    const k2 = await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    const ring = await call('POST', '/v1/ring', { code: k2.json.code, giverKey: b64(32) }, { pow: true });
    await call('POST', `/v1/knock/${k2.json.id}/reveal`, { receiverKey: b64(32), r: b64(16) });
    await call('PUT', `/v1/ring/${ring.json.ticket}/drop`, { sealed: b64(10) }, { pow: true });
    clock.advance(DROP_TTL_MS + 1);
    expect((await call('GET', `/v1/knock/${k2.json.id}/drop`)).status).toBe(404);
  });

  it('refuses writes without proof-of-work, old apps, wrong order and oversize drops', async () => {
    const { call } = setup();
    expect((await call('POST', '/v1/knock', { commitment: b64(32) })).status).toBe(428);
    expect((await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true, version: '0.16.0' })).json).toEqual({ error: 'update' });
    expect((await call('POST', '/v1/knock', { commitment: 'short' }, { pow: true })).json).toEqual({ error: 'bad-request' });
    const k = await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    expect((await call('POST', `/v1/knock/${k.json.id}/reveal`, { receiverKey: b64(32), r: b64(16) })).status).toBe(404); // not rung yet
    const ring = await call('POST', '/v1/ring', { code: k.json.code, giverKey: b64(32) }, { pow: true });
    expect((await call('PUT', `/v1/ring/${ring.json.ticket}/drop`, { sealed: b64(10) }, { pow: true })).status).toBe(404); // not revealed
    await call('POST', `/v1/knock/${k.json.id}/reveal`, { receiverKey: b64(32), r: b64(16) });
    expect((await call('PUT', `/v1/ring/${ring.json.ticket}/drop`, { sealed: b64(2 * 1024 * 1024 + 1) }, { pow: true })).json).toEqual({ error: 'too-big' });
  });

  it('a proof is used once', async () => {
    const { call } = setup();
    // Same body + same minute: solvePow is deterministic, so the second request replays the first proof
    const first = await call('POST', '/v1/knock', { commitment: b64(32, 9) }, { pow: true });
    const second = await call('POST', '/v1/knock', { commitment: b64(32, 9) }, { pow: true });
    expect(first.status).toBe(201);
    expect(second.status).toBe(428);
  });

  it('either side can cancel; the other sees cancelled', async () => {
    const { call } = setup();
    const k = await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    const ring = await call('POST', '/v1/ring', { code: k.json.code, giverKey: b64(32) }, { pow: true });
    expect((await call('POST', `/v1/knock/${k.json.id}/cancel`)).status).toBe(204);
    expect((await call('GET', `/v1/ring/${ring.json.ticket}`)).json.status).toBe('cancelled');
  });

  it('logs nothing per request', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const { call } = setup();
    await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    await call('GET', '/v1/knock/nope');
    await call('POST', '/v1/ring', 'not json', { pow: true });
    for (const s of spies) { expect(s).not.toHaveBeenCalled(); s.mockRestore(); }
  });
});
