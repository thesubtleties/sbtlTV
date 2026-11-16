import { describe, expect, it, vi } from 'vitest';
import { MailboxError, Transport } from './transport.js';

describe('Transport', () => {
  it('a relay that never answers is "offline" after the timeout, not a hang (M7)', async () => {
    const t = new Transport({ base: 'http://x', version: '0.17.0', timeoutMs: 50, fetch: () => new Promise<Response>(() => {}) });
    await expect(t.get('/v1/hello')).rejects.toMatchObject({ code: 'offline' });
    await expect(t.get('/v1/hello')).rejects.toBeInstanceOf(MailboxError);
  });
});

describe('Transport timer (lens 7)', () => {
  it('an answered request leaves no timer behind (it would abort a later read)', async () => {
    vi.useFakeTimers();
    try {
      const t = new Transport({ base: 'http://x', version: '0.17.0', timeoutMs: 50, fetch: async () => new Response('{}', { status: 200 }) });
      await t.get('/v1/hello');
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('a reply whose body never finishes is "offline" after the timeout too (review C6)', async () => {
    const stalled = () => new Response(new ReadableStream({ start() { /* headers sent, body never comes */ } }), { status: 200, headers: { 'content-type': 'application/json' } });
    const t = new Transport({ base: 'http://x', version: '0.17.0', timeoutMs: 50, fetch: async () => stalled() });
    await expect(t.get('/v1/hello')).rejects.toMatchObject({ code: 'offline' });
  });
});
