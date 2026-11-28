import { expect, test } from 'vitest';
import { makeNet } from './net';

const files = () => { const removed: string[] = []; return { removed, f: { remove: (p: string) => removed.push(p) } as never }; };
const native = (hops: Record<string, { status: number; location?: string; bytes?: number }>) => ({
  calls: [] as string[],
  async fetchToFile(url: string) { this.calls.push(url); const h = hops[url]; if (!h) throw new Error('unexpected ' + url); return { status: h.status, location: h.location ?? null, bytes: h.bytes ?? 0 }; },
});

test('follows a redirect, checking every hop', async () => {
  const n = native({ 'http://a.example/x': { status: 302, location: '/y' }, 'http://a.example/y': { status: 200, bytes: 9 } });
  const { f } = files();
  expect(await makeNet(n, f).downloadToFile('http://a.example/x', '/d', { maxBytes: 100, allowLan: false, label: 'EPG download' })).toEqual({ status: 200, bytes: 9 });
  expect(n.calls).toEqual(['http://a.example/x', 'http://a.example/y']);
});
test('a LAN hop is refused (after a public first hop) and nothing is left behind', async () => {
  const n = native({ 'http://a.example/x': { status: 302, location: 'http://192.168.0.1/admin' } });
  const { f, removed } = files();
  await expect(makeNet(n, f).downloadToFile('http://a.example/x', '/d', { maxBytes: 100, allowLan: false, label: 'EPG download' })).rejects.toThrow('Blocked: local network access is disabled');
  expect(n.calls).toEqual(['http://a.example/x']);
  expect(removed).toContain('/d');
});
test('gives up after 5 redirects, with the redacted URL', async () => {
  const hops: Record<string, { status: number; location: string }> = {};
  for (let i = 0; i < 7; i++) hops[`http://a.example/${i}?pw=secret`] = { status: 301, location: `http://a.example/${i + 1}?pw=secret` };
  const n = native(hops); const { f } = files();
  await expect(makeNet(n, f).downloadToFile('http://a.example/0?pw=secret', '/d', { maxBytes: 1, allowLan: false, label: 'x' })).rejects.toThrow('too many redirects (5) fetching http://a.example/5');
});
test('non-2xx is an HTTP error; the cap error has the shared text', async () => {
  const { f } = files();
  await expect(makeNet(native({ 'http://a.example/x': { status: 404 } }), f).downloadToFile('http://a.example/x', '/d', { maxBytes: 1, allowLan: false, label: 'x' })).rejects.toThrow('HTTP 404');
  const capped = { async fetchToFile() { throw Object.assign(new Error('size cap exceeded'), { code: 'ERR_SIZE_CAP' }); } };
  await expect(makeNet(capped as never, f).downloadToFile('http://a.example/x', '/d', { maxBytes: 4 * 1024 * 1024 * 1024, allowLan: false, label: 'EPG download' })).rejects.toThrow('EPG download exceeds 4096MB limit');
});
