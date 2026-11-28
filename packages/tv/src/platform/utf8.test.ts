import { expect, test } from 'vitest';
import { Utf8Stream } from './utf8';

const enc = new TextEncoder();
test('split characters decode whole at every split point and chunk size', () => {
  const text = 'aé€😀\n' .repeat(200) + 'Café';
  const bytes = enc.encode(text);
  for (const size of [1, 2, 3, 5, 7, 64, 4096]) {
    const d = new Utf8Stream(); let out = '';
    for (let i = 0; i < bytes.length; i += size) out += d.decode(bytes.subarray(i, i + size));
    out += d.end();
    expect(out).toBe(text);
  }
});
test('invalid bytes become U+FFFD like TextDecoder', () => {
  const bad = new Uint8Array([0x61, 0xff, 0x62, 0xe2, 0x82]);   // a, invalid, b, truncated €
  const d = new Utf8Stream(); const out = d.decode(bad) + d.end();
  expect(out).toBe(new TextDecoder().decode(bad));
});

test('matches TextDecoder on every 1-3 byte sequence (fuzz)', () => {
  let x = 7; const r = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x % 256; };
  for (let n = 0; n < 20000; n++) {
    const len = 1 + (r() % 6); const bytes = new Uint8Array(len); for (let i = 0; i < len; i++) bytes[i] = r();
    const d = new Utf8Stream(); expect(d.decode(bytes) + d.end()).toBe(new TextDecoder().decode(bytes));
  }
});

test('streamed in random chunks, random bytes decode exactly as TextDecoder decodes them whole (fuzz)', () => {
  let x = 11; const r = (m: number) => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x % m; };
  const pool = [0x41, 0x80, 0xbf, 0xc2, 0xdf, 0xe0, 0xe2, 0xed, 0xef, 0xf0, 0xf4, 0xf5, 0xff, 0xa0, 0x9f, 0x90, 0x8f];
  for (let n = 0; n < 5000; n++) {
    const len = 1 + r(24); const bytes = new Uint8Array(len); for (let i = 0; i < len; i++) bytes[i] = pool[r(pool.length)];
    const d = new Utf8Stream(); let out = '';
    for (let i = 0; i < len;) { const step = 1 + r(5); out += d.decode(bytes.subarray(i, i + step)); i += step; }
    out += d.end();
    expect(out).toBe(new TextDecoder().decode(bytes));
  }
});
