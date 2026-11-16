import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app';
import { DEFAULTS } from '../src/server/settings';
import { POW_HEADER, VERSION_HEADER, powBitsFor, powInput, solvePow, KNOCK_TTL_MS, DROP_TTL_MS } from '../src/protocol';

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Call = (method: string, path: string, body?: unknown, opts?: any) => Promise<{ status: number; json: any }>;
/** The giver's two steps: claim the code (get the commitment), then send its key. */
async function ringWithKey(call: Call, code: string, giverKey: string, opts: { pow?: boolean } | boolean = { pow: true }) {
  const ring = await call('POST', '/v1/ring', { code }, opts);
  if (ring.status === 201) {
    const key = await call('POST', `/v1/ring/${ring.json.ticket}/key`, { giverKey });
    expect(key.status).toBe(204);
  }
  return ring;
}

describe('mailbox server', () => {
  it('runs a full knock: create, ring, reveal, drop, one pickup', async () => {
    const { call } = setup();
    const k = await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    expect(k.status).toBe(201);
    expect(await call('GET', `/v1/knock/${k.json.id}`)).toMatchObject({ json: { status: 'waiting' } });

    const ring = await ringWithKey(call, k.json.code, b64(32, 2), { pow: true });
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
    expect((await ringWithKey(call, k.json.code, b64(32), { pow: true })).status).toBe(201);
    expect((await ringWithKey(call, k.json.code.toLowerCase(), b64(32, 3), { pow: true })).json).toEqual({ error: 'not-found' }); // same code, typed differently
    expect((await ringWithKey(call, 'ZZZZZZZZ', b64(32), { pow: true })).json).toEqual({ error: 'not-found' });
  });

  it('codes expire after 10 minutes; drops after 10 more (the receiver waits live)', async () => {
    const { call, clock } = setup();
    const k = await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    clock.advance(KNOCK_TTL_MS + 1);
    expect((await ringWithKey(call, k.json.code, b64(32), { pow: true })).status).toBe(404);

    const k2 = await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    const ring = await ringWithKey(call, k2.json.code, b64(32), { pow: true });
    await call('POST', `/v1/knock/${k2.json.id}/reveal`, { receiverKey: b64(32), r: b64(16) });
    await call('PUT', `/v1/ring/${ring.json.ticket}/drop`, { sealed: b64(10) }, { pow: true });
    expect(DROP_TTL_MS).toBe(10 * 60 * 1000);
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
    const ring = await ringWithKey(call, k.json.code, b64(32), { pow: true });
    expect((await call('PUT', `/v1/ring/${ring.json.ticket}/drop`, { sealed: b64(10) }, { pow: true })).status).toBe(404); // not revealed
    await call('POST', `/v1/knock/${k.json.id}/reveal`, { receiverKey: b64(32), r: b64(16) });
    expect((await call('PUT', `/v1/ring/${ring.json.ticket}/drop`, { sealed: b64(2 * 1024 * 1024 + 1) }, { pow: true })).json).toEqual({ error: 'too-big' });
  });

  it('a proof is used once', async () => {
    const { app } = createApp({ now: () => 1_800_000_000_000, powBits: BITS, minVersion: '0.17.0' });
    const text = JSON.stringify({ commitment: b64(32, 9) });
    const minute = Math.floor(1_800_000_000_000 / 60_000);
    const headers = { 'content-type': 'application/json', [VERSION_HEADER]: '0.17.0', [POW_HEADER]: `${minute}.${solvePow(powInput('/v1/knock', text, minute, '0.17.0'), BITS)}` };
    const send = () => app.fetch(new Request('http://mailbox/v1/knock', { method: 'POST', headers, body: text }));
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(428);   // the very same request again
  });

  it('either side can cancel; the other sees cancelled', async () => {
    const { call } = setup();
    const k = await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    const ring = await ringWithKey(call, k.json.code, b64(32), { pow: true });
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

  it('refuses oversized bodies before reading them, on every write route', async () => {
    const { app } = createApp({ powBits: BITS, minVersion: '0.17.0' });
    const big = 'x'.repeat(64 * 1024);
    const res = await app.fetch(new Request('http://mailbox/v1/knock', { method: 'POST', headers: { [VERSION_HEADER]: '0.17.0', 'content-type': 'application/json', 'content-length': String(big.length) }, body: big }));
    expect(res.status).toBe(413);
    const drop = 'x'.repeat(3 * 1024 * 1024 + 1);
    const res2 = await app.fetch(new Request('http://mailbox/v1/ring/0123456789abcdef0123456789abcdef/drop', { method: 'PUT', headers: { [VERSION_HEADER]: '0.17.0', 'content-length': String(drop.length) }, body: drop }));
    expect(res2.status).toBe(413);
  });

  it('keeps total drop memory under a budget', async () => {
    let t = 1_800_000_000_000;
    const { app } = createApp({ now: () => t, powBits: BITS, minVersion: '0.17.0', maxStoredBytes: 150 });
    const call = async (method: string, path: string, body?: unknown, pow = false) => {
      const text = body === undefined ? '' : JSON.stringify(body);
      const headers: Record<string, string> = { 'content-type': 'application/json', [VERSION_HEADER]: '0.17.0' };
      if (pow) { const m = Math.floor(t / 60_000); headers[POW_HEADER] = `${m}.${solvePow(powInput(path, text, m, '0.17.0'), BITS)}`; }
      const res = await app.fetch(new Request(`http://mailbox${path}`, { method, headers, body: text || undefined }));
      return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
    };
    const ready = async (fill: number) => {
      const k = await call('POST', '/v1/knock', { commitment: b64(32, fill) }, true);
      const r = await ringWithKey(call, k.json.code, b64(32, fill), true);
      await call('POST', `/v1/knock/${k.json.id}/reveal`, { receiverKey: b64(32), r: b64(16) });
      return { k, r };
    };
    const a = await ready(1);
    expect((await call('PUT', `/v1/ring/${a.r.json.ticket}/drop`, { sealed: b64(100, 1) }, true)).status).toBe(204);
    const b = await ready(2);
    expect((await call('PUT', `/v1/ring/${b.r.json.ticket}/drop`, { sealed: b64(100, 2) }, true)).json).toEqual({ error: 'busy' });
    await call('GET', `/v1/knock/${a.k.json.id}/drop`);   // pickup frees the room
    expect((await call('PUT', `/v1/ring/${b.r.json.ticket}/drop`, { sealed: b64(100, 3) }, true)).status).toBe(204);
  });

  it('rate limits by the address the proxy saw, not one the client wrote', async () => {
    let t = 1_800_000_000_000;
    const { app } = createApp({ now: () => t, powBits: BITS, minVersion: '0.17.0', writesPerHour: 2 });
    const knock = async (xff: string, fill: number) => {
      const text = JSON.stringify({ commitment: b64(32, fill) });
      const m = Math.floor(t / 60_000);
      const headers = { 'content-type': 'application/json', [VERSION_HEADER]: '0.17.0', [POW_HEADER]: `${m}.${solvePow(powInput('/v1/knock', text, m, '0.17.0'), BITS)}`, 'x-forwarded-for': xff };
      return (await app.fetch(new Request('http://mailbox/v1/knock', { method: 'POST', headers, body: text }))).status;
    };
    // The client prepends a fake address each time; the proxy appends the real one (last)
    expect(await knock('1.1.1.1, 9.9.9.9', 1)).toBe(201);
    expect(await knock('2.2.2.2, 9.9.9.9', 2)).toBe(201);
    expect(await knock('3.3.3.3, 9.9.9.9', 3)).toBe(429);
  });

  it('the commitment comes before the giver sends its key; a ticket takes one key', async () => {
    const { call } = setup();
    const k = await call('POST', '/v1/knock', { commitment: b64(32, 6) }, { pow: true });
    const ring = await call('POST', '/v1/ring', { code: k.json.code }, { pow: true });
    expect(ring.json).toEqual({ ticket: expect.any(String), commitment: b64(32, 6) });
    expect((await call('GET', `/v1/knock/${k.json.id}`)).json).toEqual({ status: 'claimed' }); // no key yet, nothing to reveal to
    expect((await call('POST', `/v1/knock/${k.json.id}/reveal`, { receiverKey: b64(32), r: b64(16) })).status).toBe(404);
    expect((await call('POST', `/v1/ring/${ring.json.ticket}/key`, { giverKey: b64(32, 2) })).status).toBe(204);
    expect((await call('POST', `/v1/ring/${ring.json.ticket}/key`, { giverKey: b64(32, 3) })).status).toBe(404);
    expect((await call('GET', `/v1/knock/${k.json.id}`)).json).toEqual({ status: 'rung', giverKey: b64(32, 2) });
  });

  it('a big drop needs more proof-of-work', async () => {
    const { call } = setup();
    const k = await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    const ring = await ringWithKey(call, k.json.code, b64(32));
    await call('POST', `/v1/knock/${k.json.id}/reveal`, { receiverKey: b64(32), r: b64(16) });
    // 1 MB at the base difficulty is refused with the bits it needs
    const res = await call('PUT', `/v1/ring/${ring.json.ticket}/drop`, { sealed: b64(1024 * 1024) }, { pow: true });
    expect(res.status).toBe(428);
  });

  it('two drops at once on one knock store one', async () => {
    const { call } = setup();
    const k = await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    const ring = await ringWithKey(call, k.json.code, b64(32));
    await call('POST', `/v1/knock/${k.json.id}/reveal`, { receiverKey: b64(32), r: b64(16) });
    const [a, b] = await Promise.all([
      call('PUT', `/v1/ring/${ring.json.ticket}/drop`, { sealed: b64(10, 1) }, { pow: true }),
      call('PUT', `/v1/ring/${ring.json.ticket}/drop`, { sealed: b64(10, 2) }, { pow: true }),
    ]);
    expect([a.status, b.status].sort()).toEqual([204, 404]);
  });

  it('requests without a valid proof do not use up the write limit', async () => {
    const t = 1_800_000_000_000;
    const { app } = createApp({ now: () => t, powBits: BITS, minVersion: '0.17.0', writesPerHour: 2 });
    for (let i = 0; i < 5; i++) {
      await app.fetch(new Request('http://mailbox/v1/knock', { method: 'POST', headers: { [VERSION_HEADER]: '0.17.0', 'content-type': 'application/json' }, body: '{"commitment":"junk"}' }));
    }
    const text = JSON.stringify({ commitment: b64(32) });
    const m = Math.floor(t / 60_000);
    const res = await app.fetch(new Request('http://mailbox/v1/knock', { method: 'POST', headers: { 'content-type': 'application/json', [VERSION_HEADER]: '0.17.0', [POW_HEADER]: `${m}.${solvePow(powInput('/v1/knock', text, m, '0.17.0'), BITS)}` }, body: text }));
    expect(res.status).toBe(201);
  });

  it('tells the client its clock, so a computer with a wrong clock can still prove work', async () => {
    const { app } = createApp({ now: () => 1_800_000_000_000, powBits: BITS, minVersion: '0.17.0' });
    const res = await app.fetch(new Request('http://mailbox/v1/knock', { method: 'POST', headers: { [VERSION_HEADER]: '0.17.0' }, body: '{}' }));
    expect(res.headers.get('x-sbtltv-time')).toBe('1800000000000');
  });

  it('the giver cancelling shows up on the receiver', async () => {
    const { call } = setup();
    const k = await call('POST', '/v1/knock', { commitment: b64(32) }, { pow: true });
    const ring = await ringWithKey(call, k.json.code, b64(32));
    await call('POST', `/v1/ring/${ring.json.ticket}/cancel`);
    expect((await call('GET', `/v1/knock/${k.json.id}`)).json).toEqual({ status: 'cancelled' });
  });

  it('hello tells the app the current level and the time, without any work', async () => {
    const { app } = createApp({ now: () => 1_800_000_000_000, powBits: 20, minVersion: '0.17.0' });
    const res = await app.fetch(new Request('http://mailbox/v1/hello', { headers: { [VERSION_HEADER]: '0.17.0' } }));
    expect(await res.json()).toEqual({ bits: 20, time: 1_800_000_000_000 });
    expect(res.headers.get('x-sbtltv-pow-level')).toBe('20');
  });

  it('large drops share an hourly budget; small ones are never held back by it', async () => {
    let t = 1_800_000_000_000;
    const { app } = createApp({ now: () => t, powBits: BITS, minVersion: '0.17.0', largeDropBytesPerHour: 400 * 1024 });
    const call = async (method: string, path: string, body?: unknown, pow = false) => {
      const text = body === undefined ? '' : JSON.stringify(body);
      const headers: Record<string, string> = { 'content-type': 'application/json', [VERSION_HEADER]: '0.17.0' };
      if (pow) { const m = Math.floor(t / 60_000); headers[POW_HEADER] = `${m}.${solvePow(powInput(path, text, m, '0.17.0'), powBitsFor(BITS, Buffer.byteLength(text)))}`; }
      const res = await app.fetch(new Request(`http://mailbox${path}`, { method, headers, body: text || undefined }));
      return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
    };
    const ready = async (fill: number) => {
      const k = await call('POST', '/v1/knock', { commitment: b64(32, fill) }, true);
      const r = await ringWithKey(call, k.json.code, b64(32, fill), true);
      await call('POST', `/v1/knock/${k.json.id}/reveal`, { receiverKey: b64(32), r: b64(16) });
      return r.json.ticket as string;
    };
    expect((await call('PUT', `/v1/ring/${await ready(1)}/drop`, { sealed: b64(300 * 1024, 1) }, true)).status).toBe(204);
    expect((await call('PUT', `/v1/ring/${await ready(2)}/drop`, { sealed: b64(300 * 1024, 2) }, true)).json).toEqual({ error: 'busy' });
    expect((await call('PUT', `/v1/ring/${await ready(3)}/drop`, { sealed: b64(1024, 3) }, true)).status).toBe(204);
    t += 3_600_000;
    expect((await call('PUT', `/v1/ring/${await ready(4)}/drop`, { sealed: b64(300 * 1024, 4) }, true)).status).toBe(204);
  }, 60_000);

  it('switches: paused refuses all writes; large drops paused refuses only big ones', async () => {
    const t = 1_800_000_000_000;
    const paused = createApp({ now: () => t, powBits: BITS, minVersion: '0.17.0', paused: true }).app;
    const text = JSON.stringify({ commitment: b64(32) });
    const m = Math.floor(t / 60_000);
    const res = await paused.fetch(new Request('http://mailbox/v1/knock', { method: 'POST', headers: { 'content-type': 'application/json', [VERSION_HEADER]: '0.17.0', [POW_HEADER]: `${m}.${solvePow(powInput('/v1/knock', text, m, '0.17.0'), BITS)}` }, body: text }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'busy' });
    const { app } = createApp({ now: () => t, powBits: BITS, minVersion: '0.17.0', largeDropsPaused: true });
    const call = async (method: string, path: string, body?: unknown, pow = false) => {
      const tx = body === undefined ? '' : JSON.stringify(body);
      const headers: Record<string, string> = { 'content-type': 'application/json', [VERSION_HEADER]: '0.17.0' };
      if (pow) headers[POW_HEADER] = `${m}.${solvePow(powInput(path, tx, m, '0.17.0'), powBitsFor(BITS, Buffer.byteLength(tx)))}`;
      const r = await app.fetch(new Request(`http://mailbox${path}`, { method, headers, body: tx || undefined }));
      return { status: r.status, json: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
    };
    const k = await call('POST', '/v1/knock', { commitment: b64(32, 5) }, true);
    const r = await ringWithKey(call, k.json.code, b64(32, 5), true);
    await call('POST', `/v1/knock/${k.json.id}/reveal`, { receiverKey: b64(32), r: b64(16) });
    expect((await call('PUT', `/v1/ring/${r.json.ticket}/drop`, { sealed: b64(300 * 1024) }, true)).json).toEqual({ error: 'busy' });
    expect((await call('PUT', `/v1/ring/${r.json.ticket}/drop`, { sealed: b64(1024) }, true)).status).toBe(204);
  }, 60_000);

  it('large drops sent at the same moment cannot overrun the hourly budget together', async () => {
    const t = 1_800_000_000_000;
    const { app } = createApp({ now: () => t, powBits: BITS, minVersion: '0.17.0', largeDropBytesPerHour: 400 * 1024 });
    const m = Math.floor(t / 60_000);
    const call = async (method: string, path: string, body?: unknown, pow = false) => {
      const text = body === undefined ? '' : JSON.stringify(body);
      const headers: Record<string, string> = { 'content-type': 'application/json', [VERSION_HEADER]: '0.17.0' };
      if (pow) headers[POW_HEADER] = `${m}.${solvePow(powInput(path, text, m, '0.17.0'), powBitsFor(BITS, Buffer.byteLength(text)))}`;
      const res = await app.fetch(new Request(`http://mailbox${path}`, { method, headers, body: text || undefined }));
      return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
    };
    const tickets: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const k = await call('POST', '/v1/knock', { commitment: b64(32, i) }, true);
      const r = await ringWithKey(call, k.json.code, b64(32, i), true);
      await call('POST', `/v1/knock/${k.json.id}/reveal`, { receiverKey: b64(32), r: b64(16) });
      tickets.push(r.json.ticket);
    }
    const results = await Promise.all(tickets.map((tk, i) => call('PUT', `/v1/ring/${tk}/drop`, { sealed: b64(300 * 1024, i + 1) }, true)));
    expect(results.filter((r) => r.status === 204)).toHaveLength(1);
  }, 60_000);

  it('settings changed while running take effect on the next request', async () => {
    const t = 1_800_000_000_000;
    let paused = false;
    const { app } = createApp({ now: () => t, minVersion: '0.17.0', settings: () => ({ ...DEFAULTS, powBits: BITS, minVersion: '0.17.0', paused }) });
    const m = Math.floor(t / 60_000);
    const knock = async (fill: number) => {
      const text = JSON.stringify({ commitment: b64(32, fill) });
      return (await app.fetch(new Request('http://mailbox/v1/knock', { method: 'POST', headers: { 'content-type': 'application/json', [VERSION_HEADER]: '0.17.0', [POW_HEADER]: `${m}.${solvePow(powInput('/v1/knock', text, m, '0.17.0'), BITS)}` }, body: text }))).status;
    };
    expect(await knock(1)).toBe(201);
    paused = true;
    expect(await knock(2)).toBe(429);
  });
});
