import { describe, expect, it } from 'vitest';
import { checkReveal, dropAad, dropKey, knockWords, newKeyPair, newReceiverSecret, open, seal } from '../src/protocol/pairing';

const WORDS = Array.from({ length: 7776 }, (_, i) => `w${i}`);

describe('pairing', () => {
  it('commitment checks only the revealed key it was made for', () => {
    const rx = newReceiverSecret();
    expect(checkReveal(rx.commitment, rx.keys.publicRaw, rx.r)).toBe(true);
    const other = newKeyPair();
    expect(checkReveal(rx.commitment, other.publicRaw, rx.r)).toBe(false); // swapped key (man in the middle)
    expect(checkReveal(rx.commitment, rx.keys.publicRaw, Buffer.alloc(16))).toBe(false);
    expect(checkReveal(rx.commitment, Buffer.alloc(5), rx.r)).toBe(false); // wrong length, no throw
  });

  it('both sides get the same three words; a substituted key gives different words', () => {
    const rx = newReceiverSecret();
    const giver = newKeyPair();
    const a = knockWords(rx.commitment, giver.publicRaw, rx.keys.publicRaw, WORDS);
    const b = knockWords(rx.commitment, giver.publicRaw, rx.keys.publicRaw, WORDS);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    const mitm = newKeyPair();
    expect(knockWords(rx.commitment, mitm.publicRaw, rx.keys.publicRaw, WORDS)).not.toEqual(a);
  });

  it('a drop sealed by the giver opens only for the receiver, only with the same knock', () => {
    const rx = newReceiverSecret();
    const giver = newKeyPair();
    const kGiver = dropKey(giver, rx.keys.publicRaw, rx.commitment);
    const kRx = dropKey(rx.keys, giver.publicRaw, rx.commitment);
    expect(kGiver.equals(kRx)).toBe(true);
    const sealed = seal(kGiver, Buffer.from('hello'), dropAad(Buffer.from('k1')));
    expect(open(kRx, sealed, dropAad(Buffer.from('k1'))).toString()).toBe('hello');
    expect(() => open(kRx, sealed, dropAad(Buffer.from('k2')))).toThrow();       // moved to another knock
    const tampered = Buffer.from(sealed); tampered[20] ^= 1;
    expect(() => open(kRx, tampered, dropAad(Buffer.from('k1')))).toThrow();     // edited on the server
    const stranger = newKeyPair();
    expect(dropKey(stranger, giver.publicRaw, rx.commitment).equals(kRx)).toBe(false);
  });

  it('every seal uses a fresh nonce', () => {
    const k = Buffer.alloc(32, 1);
    expect(seal(k, Buffer.from('x'), Buffer.alloc(0)).subarray(0, 12)).not.toEqual(seal(k, Buffer.from('x'), Buffer.alloc(0)).subarray(0, 12));
  });

  it('relay base64 is read strictly: canonical text and the expected length only', async () => {
    const { decodeB64 } = await import('../src/protocol/pairing');
    const good = Buffer.alloc(32, 7).toString('base64');
    expect(decodeB64(good, 32).length).toBe(32);
    expect(() => decodeB64(good, 16)).toThrow();
    expect(() => decodeB64(good.replace(/=$/, ''), 32)).toThrow();      // unpadded variant of the same bytes
    expect(() => decodeB64('AB=C')).toThrow();
    expect(() => decodeB64(42)).toThrow();
  });
});
