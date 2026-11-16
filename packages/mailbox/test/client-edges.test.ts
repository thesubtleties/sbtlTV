import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { KNOCK_TTL_MS } from '../src/protocol';
import { Receiver, Sender, Transport, type ReceiveState } from '../src/client';

const WORDS = Array.from({ length: 7776 }, (_, i) => `w${i}`);
const until = async (pred: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Fetch = (r: Request) => Promise<Response>;
const transport = (fetch: Fetch, extra: Partial<ConstructorParameters<typeof Transport>[0]> = {}) =>
  new Transport({ base: 'http://mailbox', version: '0.17.0', bits: 4, fetch, ...extra });
const codeOf = (s: ReceiveState) => (s as { code: string }).code;
const path = (r: Request) => new URL(r.url).pathname;

describe('transport: a refused proof is redone once', () => {
  it('when the server wants more work than the app was told, the app redoes it at the asked level', async () => {
    const { app } = createApp({ powBits: 12, minVersion: '0.17.0' });
    const posts: number[] = [];
    // The level the app hears is stale (4) while the server needs 12: only the 428's bits header can fix it
    const stale: Fetch = async (r) => {
      const res = await app.fetch(r);
      if (r.method === 'POST' && path(r) === '/v1/knock') posts.push(res.status);
      const h = new Headers(res.headers); h.set('x-sbtltv-pow-level', '4');
      return new Response(res.body, { status: res.status, headers: h });
    };
    const receiver = new Receiver(transport(stale), WORDS, () => {}, { pollMs: 5 });
    void receiver.start();
    await until(() => receiver.state.step === 'code' || receiver.state.step === 'failed');
    expect(receiver.state.step).toBe('code');
    // A 4-bit proof can meet 12 bits by luck (1 in 256); otherwise exactly one refusal then success
    expect(posts.at(-1)).toBe(201);
    expect(posts.length).toBeLessThanOrEqual(2);
    await receiver.cancel();
  });

  it('a computer whose clock is off gets through even when hello could not be reached', async () => {
    const { app } = createApp({ powBits: 4, minVersion: '0.17.0' });
    const noHello: Fetch = async (r) => { if (path(r) === '/v1/hello') throw new TypeError('fetch failed'); return app.fetch(r); };
    const receiver = new Receiver(transport(noHello, { now: () => Date.now() - 15 * 60_000 }), WORDS, () => {}, { pollMs: 5 });
    void receiver.start();
    await until(() => receiver.state.step === 'code' || receiver.state.step === 'failed');
    expect(receiver.state.step).toBe('code');
    await receiver.cancel();
  });

  it('a level above what the app will do is not believed from a header', async () => {
    const seen: number[] = [];
    const t = transport(async () => new Response('{}', { status: 201, headers: { 'x-sbtltv-pow-level': '40', 'content-type': 'application/json' } }), { onWork: (b) => seen.push(b) });
    await t.post('/v1/knock', {}, true);   // hello says 40: ignored, the app keeps its own level
    await t.post('/v1/knock', {}, true);
    expect(seen).toEqual([4, 4]);
  });
});

describe('polls: only failures in a row end a knock', () => {
  it('a success in between resets the count', async () => {
    const { app } = createApp({ powBits: 4, minVersion: '0.17.0' });
    let dropNext = 0;
    const flaky: Fetch = async (r) => { if (r.method === 'GET' && dropNext > 0) { dropNext--; throw new TypeError('fetch failed'); } return app.fetch(r); };
    const receiver = new Receiver(transport(flaky), WORDS, () => {}, { pollMs: 5 });
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    for (let i = 0; i < 3; i++) {
      dropNext = 2;
      await until(() => dropNext === 0);
      await sleep(30);   // a few good polls
    }
    expect(receiver.state.step).toBe('code');
    await receiver.cancel();
  });
});

describe('receiver edges', () => {
  it('a receiver cancelled while its code is being made cancels that code on the server', async () => {
    const { app } = createApp({ powBits: 4, minVersion: '0.17.0' });
    let receiver!: Receiver;
    let id = '';
    const slow: Fetch = async (r) => {
      const res = await app.fetch(r);
      if (r.method === 'POST' && path(r) === '/v1/knock') { id = (await res.clone().json()).id; await receiver.cancel(); }
      return res;
    };
    receiver = new Receiver(transport(slow), WORDS, () => {}, { pollMs: 5 });
    await receiver.start();
    expect(receiver.state).toEqual({ step: 'failed', reason: 'cancelled' });
    const res = await app.fetch(new Request(`http://mailbox/v1/knock/${id}`, { headers: { 'x-sbtltv-version': '0.17.0' } }));
    expect(await res.json()).toEqual({ status: 'cancelled' });
  });

  it('a code that runs out shows as expired', async () => {
    let t = Date.now();
    const { app } = createApp({ now: () => t, powBits: 4, minVersion: '0.17.0' });
    const receiver = new Receiver(transport((r) => Promise.resolve(app.fetch(r))), WORDS, () => {}, { pollMs: 5 });
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    t += KNOCK_TTL_MS + 1;
    await until(() => receiver.state.step === 'failed');
    expect(receiver.state).toEqual({ step: 'failed', reason: 'expired' });
  });

  it('"Same words" pressed before there are words does not count', async () => {
    const { app } = createApp({ powBits: 4, minVersion: '0.17.0' });
    const f: Fetch = (r) => Promise.resolve(app.fetch(r));
    const receiver = new Receiver(transport(f), WORDS, () => {}, { pollMs: 5 });
    const sender = new Sender(transport(f), WORDS, () => {}, { pollMs: 5 });
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    receiver.confirmWords();   // too early: nothing to compare yet
    void sender.ring(codeOf(receiver.state));
    await until(() => sender.state.step === 'words');
    void sender.confirm(Buffer.from('x'));
    await until(() => sender.state.step === 'sent');
    await sleep(50);
    expect(receiver.state.step).toBe('words');
    await receiver.cancel();
  });

  it('a drop whose giver key differs from the one rung with is refused', async () => {
    const { app } = createApp({ powBits: 4, minVersion: '0.17.0' });
    const swap: Fetch = async (r) => {
      const res = await app.fetch(r);
      if (r.method === 'GET' && /\/v1\/knock\/[^/]+\/drop$/.test(path(r))) {
        const j = await res.json();
        return new Response(JSON.stringify({ ...j, giverKey: Buffer.alloc(32, 9).toString('base64') }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return res;
    };
    const receiver = new Receiver(transport(swap), WORDS, () => {}, { pollMs: 5 });
    const sender = new Sender(transport((r) => Promise.resolve(app.fetch(r))), WORDS, () => {}, { pollMs: 5 });
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    void sender.ring(codeOf(receiver.state));
    await until(() => sender.state.step === 'words' && receiver.state.step === 'words');
    receiver.confirmWords();
    void sender.confirm(Buffer.from('x'));
    await until(() => receiver.state.step === 'failed');
    expect(receiver.state).toEqual({ step: 'failed', reason: 'broken' });
  });
});

describe('giver edges', () => {
  it('the receiver cancelling after the drop shows up on the giver', async () => {
    const { app } = createApp({ powBits: 4, minVersion: '0.17.0' });
    const f: Fetch = (r) => Promise.resolve(app.fetch(r));
    const receiver = new Receiver(transport(f), WORDS, () => {}, { pollMs: 5 });
    const sender = new Sender(transport(f), WORDS, () => {}, { pollMs: 5 });
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    void sender.ring(codeOf(receiver.state));
    await until(() => sender.state.step === 'words' && receiver.state.step === 'words');
    void sender.confirm(Buffer.from('x'));   // the receiver never confirms the words
    await until(() => sender.state.step === 'sent');
    await receiver.cancel();
    await until(() => sender.state.step === 'failed');
    expect(sender.state).toEqual({ step: 'failed', reason: 'cancelled' });
  });

  it('a giver that catches a swapped key also ends the knock for the receiver', async () => {
    const { app } = createApp({ powBits: 4, minVersion: '0.17.0' });
    const evil: Fetch = async (r) => {
      const res = await app.fetch(r);
      if (r.method === 'GET' && path(r).startsWith('/v1/ring/')) {
        const j = await res.clone().json();
        if (j.receiverKey) j.receiverKey = Buffer.alloc(32, 7).toString('base64');
        return new Response(JSON.stringify(j), { status: res.status, headers: { 'content-type': 'application/json' } });
      }
      return res;
    };
    const receiver = new Receiver(transport((r) => Promise.resolve(app.fetch(r))), WORDS, () => {}, { pollMs: 5 });
    const sender = new Sender(transport(evil), WORDS, () => {}, { pollMs: 5 });
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    await sender.ring(codeOf(receiver.state));
    expect(sender.state).toEqual({ step: 'failed', reason: 'mismatch' });
    await until(() => receiver.state.step === 'failed');
    expect(receiver.state).toEqual({ step: 'failed', reason: 'cancelled' });
  });
});
