// packages/mailbox/src/server/sealed-check.test.ts
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BOX_PAD, deriveGroup, newDeviceId, sealBox, seal } from '../protocol/index.js';
import { looksSealed } from './sealed-check.js';

const text = Buffer.from('Plain readable text that anyone could open. '.repeat(2000));
/** n random bytes starting with the given signature */
const withSignature = (sig: number[], n = BOX_PAD) => { const b = randomBytes(n); Buffer.from(sig).copy(b); return b; };

describe('looksSealed', () => {
  it('real sealed boxes and drops always pass, whatever they hold', () => {
    const g = deriveGroup(randomBytes(32));
    for (const plain of [Buffer.alloc(0), Buffer.from('{}'), text, randomBytes(600_000)]) {
      expect(looksSealed(sealBox(g.encKey, g.groupId, newDeviceId(), plain))).toBe(true);
    }
    expect(looksSealed(seal(randomBytes(32), text, Buffer.from('aad')))).toBe(true);
    expect(looksSealed(seal(randomBytes(32), Buffer.from('tiny'), Buffer.from('aad')))).toBe(true);
  });

  it('random bytes of every box size pass (no false refusals)', () => {
    for (let n = BOX_PAD; n <= 1024 * 1024; n += BOX_PAD) {
      for (let i = 0; i < 4; i++) expect(looksSealed(randomBytes(n))).toBe(true);
    }
  });

  it('refuses plain text, base64 and patterned bytes', () => {
    expect(looksSealed(text)).toBe(false);
    expect(looksSealed(Buffer.from(randomBytes(BOX_PAD).toString('base64')))).toBe(false);
    expect(looksSealed(Buffer.alloc(BOX_PAD))).toBe(false);
    const ramp = Buffer.alloc(BOX_PAD); for (let i = 0; i < ramp.length; i++) ramp[i] = i & 255;
    expect(looksSealed(ramp)).toBe(false);   // every byte value equally often, but compresses
  });

  it('refuses archives by their signature, even when they look random inside', () => {
    expect(looksSealed(gzipSync(randomBytes(BOX_PAD)))).toBe(false);
    for (const sig of [[0x1f, 0x8b, 0x08], [0x50, 0x4b, 0x03, 0x04], [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], [0x28, 0xb5, 0x2f, 0xfd],
      [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], [0x42, 0x5a, 0x68], [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], [0x77, 0x4f, 0x46, 0x32]]) {
      expect(looksSealed(withSignature(sig))).toBe(false);
    }
  });

  it('refuses anything shorter than a nonce and tag; tiny uploads are not judged', () => {
    expect(looksSealed(randomBytes(27))).toBe(false);
    expect(looksSealed(Buffer.from('a short readable note, under 2 KB'.padEnd(100)))).toBe(true);
  });
});
