import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, formatCode, newCode, normaliseCode } from '../src/protocol/code';

describe('codes', () => {
  it('are 8 chars from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const c = newCode();
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    }
    expect(CODE_ALPHABET).toHaveLength(32);
  });
  it('maps all 256 byte values evenly onto the 32 letters (no bias)', () => {
    let at = 0;
    const counts = new Map<string, number>();
    for (let i = 0; i < 32; i++) {
      const c = newCode((n) => { const b = Buffer.alloc(n); for (let j = 0; j < n; j++) b[j] = at++ % 256; return b; });
      for (const ch of c) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(32);
    expect(new Set(counts.values()).size).toBe(1);
  });
  it('accepts what people type: case, spaces, dashes, O/I/L', () => {
    expect(normaliseCode('7kq4-m2xd')).toBe('7KQ4M2XD');
    expect(normaliseCode(' 7KQ4 M2XD ')).toBe('7KQ4M2XD');
    expect(normaliseCode('O1IL-ABCD')).toBe('0111ABCD');
    expect(normaliseCode('7KQ4-M2X')).toBeNull();
    expect(normaliseCode('7KQ4-M2XU')).toBeNull(); // U is not in the alphabet
  });
  it('formats with a dash', () => {
    expect(formatCode('7KQ4M2XD')).toBe('7KQ4-M2XD');
  });
});
