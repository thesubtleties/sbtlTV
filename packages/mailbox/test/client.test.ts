import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { Receiver, Sender, Transport, type ReceiveState, type SendState } from '../src/client';

const WORDS = Array.from({ length: 7776 }, (_, i) => `w${i}`);
const until = async (pred: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
};
const transport = (fetch: (r: Request) => Promise<Response>, version = '0.17.0') => new Transport({ base: 'http://mailbox', version, bits: 4, fetch });

function pair() {
  const { app } = createApp({ powBits: 4, minVersion: '0.17.0' });
  const f = (r: Request) => Promise.resolve(app.fetch(r));
  const rx: ReceiveState[] = []; const tx: SendState[] = [];
  const receiver = new Receiver(transport(f), WORDS, (s) => rx.push(s), { pollMs: 5 });
  const sender = new Sender(transport(f), WORDS, (s) => tx.push(s), { pollMs: 5 });
  return { app, f, receiver, sender, rx, tx };
}
const codeOf = (s: ReceiveState) => (s as { code: string }).code;

describe('knock clients', () => {
  it('send a payload end to end; both see the same words first', async () => {
    const { receiver, sender, rx, tx } = pair();
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    void sender.ring(codeOf(receiver.state).toLowerCase());
    await until(() => sender.state.step === 'words' && receiver.state.step === 'words');
    expect((sender.state as { words: string[] }).words).toEqual((receiver.state as { words: string[] }).words);
    receiver.confirmWords();
    void sender.confirm(Buffer.from('the setup'));
    await until(() => receiver.state.step === 'received' && sender.state.step === 'received');
    expect((receiver.state as { payload: Buffer }).payload.toString()).toBe('the setup');
    expect(rx.map((s) => s.step)).toEqual(['starting', 'code', 'words', 'received']);
    expect(tx.map((s) => s.step)).toEqual(['ringing', 'words', 'sending', 'sent', 'received']);
  });

  it('receiver cancelling shows up on the giver', async () => {
    const { receiver, sender } = pair();
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    void sender.ring(codeOf(receiver.state));
    await until(() => sender.state.step === 'words');
    await receiver.cancel();
    expect(receiver.state).toEqual({ step: 'failed', reason: 'cancelled' });
    await until(() => sender.state.step === 'failed');
    expect(sender.state).toEqual({ step: 'failed', reason: 'cancelled' });
  });

  it('an unknown, malformed or already used code fails cleanly', async () => {
    const { receiver, sender, f } = pair();
    await sender.ring('ZZZZ-ZZZZ');
    expect(sender.state).toEqual({ step: 'failed', reason: 'not-found' });
    await sender.ring('nope');
    expect(sender.state).toEqual({ step: 'failed', reason: 'not-found' });
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    const code = codeOf(receiver.state);
    const second = new Sender(transport(f), WORDS, () => {}, { pollMs: 5 });
    void sender.ring(code);
    await until(() => sender.state.step === 'words');
    await second.ring(code);
    expect(second.state).toEqual({ step: 'failed', reason: 'not-found' });
  });

  it('a too-old app gets update; no network gets offline', async () => {
    const { app } = createApp({ powBits: 4, minVersion: '9.0.0' });
    const old = new Receiver(transport((r) => Promise.resolve(app.fetch(r))), WORDS, () => {});
    await old.start();
    expect(old.state).toEqual({ step: 'failed', reason: 'update' });
    const offline = new Receiver(transport(() => Promise.reject(new TypeError('fetch failed'))), WORDS, () => {});
    await offline.start();
    expect(offline.state).toEqual({ step: 'failed', reason: 'offline' });
  });

  it('a server that swaps the receiver key is caught by the commitment', async () => {
    const { app } = createApp({ powBits: 4, minVersion: '0.17.0' });
    // Rewrites receiverKey in the giver's poll, like a hijacked server would
    const evil = async (r: Request) => {
      const res = await app.fetch(r);
      if (r.method === 'GET' && r.url.includes('/v1/ring/')) {
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
  });

  it('the receiver opens nothing until its person confirms the words', async () => {
    const { receiver, sender } = pair();
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    void sender.ring(codeOf(receiver.state));
    await until(() => sender.state.step === 'words' && receiver.state.step === 'words');
    void sender.confirm(Buffer.from('x'));
    await until(() => sender.state.step === 'sent');
    await new Promise((r) => setTimeout(r, 50));
    expect(receiver.state.step).toBe('words');           // dropped, but not fetched or opened
    receiver.confirmWords();
    await until(() => receiver.state.step === 'received');
  });

  it('the giver sends its key only after it holds the commitment', async () => {
    const { app } = createApp({ powBits: 4, minVersion: '0.17.0' });
    const seen: { path: string; body: string }[] = [];
    const spy = async (r: Request) => {
      seen.push({ path: new URL(r.url).pathname, body: r.method === 'GET' ? '' : await r.clone().text() });
      return app.fetch(r);
    };
    const receiver = new Receiver(transport((r) => Promise.resolve(app.fetch(r))), WORDS, () => {}, { pollMs: 5 });
    const sender = new Sender(transport(spy), WORDS, () => {}, { pollMs: 5 });
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    void sender.ring(codeOf(receiver.state));
    await until(() => sender.state.step === 'words');
    const ring = seen.findIndex((x) => x.path === '/v1/ring');
    const key = seen.findIndex((x) => x.path.endsWith('/key'));
    expect(Object.keys(JSON.parse(seen[ring].body))).toEqual(['code']);
    expect(key).toBeGreaterThan(ring);
    expect(JSON.parse(seen[key].body)).toHaveProperty('giverKey');
  });

  it('the giver cancelling shows up on the receiver as cancelled', async () => {
    const { receiver, sender } = pair();
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    void sender.ring(codeOf(receiver.state));
    await until(() => sender.state.step === 'words');
    await sender.cancel();
    await until(() => receiver.state.step === 'failed');
    expect(receiver.state).toEqual({ step: 'failed', reason: 'cancelled' });
  });

  it('a giver that fails (too big) lets the receiver know instead of leaving it waiting', async () => {
    const { receiver, sender } = pair();
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    void sender.ring(codeOf(receiver.state));
    await until(() => sender.state.step === 'words');
    await sender.confirm(Buffer.alloc(3 * 1024 * 1024));
    expect(sender.state).toEqual({ step: 'failed', reason: 'too-big' });
    await until(() => receiver.state.step === 'failed');
    expect(receiver.state).toEqual({ step: 'failed', reason: 'cancelled' });
  });

  it('a giver cancelled while ringing does not keep the code', async () => {
    const { app } = createApp({ powBits: 4, minVersion: '0.17.0' });
    const f = (r: Request) => Promise.resolve(app.fetch(r));
    const receiver = new Receiver(transport(f), WORDS, () => {}, { pollMs: 5 });
    let sender!: Sender;
    // Cancel arrives while the ring request is in flight
    const slow = async (r: Request) => { const res = await f(r); if (new URL(r.url).pathname === '/v1/ring') await sender.cancel(); return res; };
    sender = new Sender(transport(slow), WORDS, () => {}, { pollMs: 5 });
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    await sender.ring(codeOf(receiver.state));
    await until(() => receiver.state.step === 'failed');
    expect(receiver.state).toEqual({ step: 'failed', reason: 'cancelled' });
  });

  it('a computer whose clock is off still gets through (the server tells the time)', async () => {
    const { app } = createApp({ powBits: 4, minVersion: '0.17.0' });
    const skewed = new Transport({ base: 'http://mailbox', version: '0.17.0', bits: 4, now: () => Date.now() - 15 * 60_000, fetch: (r) => Promise.resolve(app.fetch(r)) });
    const receiver = new Receiver(skewed, WORDS, () => {}, { pollMs: 5 });
    void receiver.start();
    await until(() => receiver.state.step === 'code' || receiver.state.step === 'failed');
    expect(receiver.state.step).toBe('code');
    await receiver.cancel();
  });

  it('a big drop is proven at the size-based difficulty first time (no wasted solve)', async () => {
    const { app } = createApp({ powBits: 4, minVersion: '0.17.0' });
    const statuses: number[] = [];
    const watch = async (r: Request) => { const res = await app.fetch(r); if (r.method === 'PUT') statuses.push(res.status); return res; };
    const receiver = new Receiver(transport((r) => Promise.resolve(app.fetch(r))), WORDS, () => {}, { pollMs: 5 });
    const sender = new Sender(transport(watch), WORDS, () => {}, { pollMs: 5 });
    void receiver.start();
    await until(() => receiver.state.step === 'code');
    void sender.ring(codeOf(receiver.state));
    await until(() => sender.state.step === 'words');
    receiver.confirmWords();
    void sender.confirm(Buffer.alloc(512 * 1024, 1));
    await until(() => sender.state.step === 'received', 20_000);
    expect(statuses).toEqual([204]);
  }, 30_000);
});
