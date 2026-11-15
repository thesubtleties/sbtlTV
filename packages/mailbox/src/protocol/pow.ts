/**
 * Hashcash-style proof-of-work: SHA-256(input ‖ nonce) starts with `bits` zero bits. The input
 * binds the app version, the route, the exact body and the minute, so a proof can't be reused
 * elsewhere or later, and a home-made script has to keep claiming a current version.
 * 20 bits ≈ 1 M hashes ≈ about a second in Node.
 */
import { createHash, randomInt } from 'node:crypto';

export const POW_HEADER = 'x-sbtltv-pow';

export function powInput(route: string, body: string, minute: number, version: string): string {
  return `sbtl-pow1|${version}|${minute}|${route}|${createHash('sha256').update(body).digest('hex')}|`;
}

function leadingZeroBits(h: Buffer): number {
  let n = 0;
  for (const byte of h) {
    if (byte === 0) { n += 8; continue; }
    return n + Math.clz32(byte) - 24;
  }
  return n;
}

export function checkPow(input: string, nonce: string, bits: number): boolean {
  if (!/^\d{1,16}$/.test(nonce)) return false;
  return leadingZeroBits(createHash('sha256').update(input + nonce).digest()) >= bits;
}

/** Starts at a random point, so two people solving the same input never send the same proof. */
export function solvePow(input: string, bits: number): string {
  for (let i = randomInt(0, 2 ** 47); ; i++) {
    const nonce = String(i);
    if (checkPow(input, nonce, bits)) return nonce;
  }
}

/** Bigger bodies cost more: one extra bit (twice the work) per doubling above 64 KB. */
export function powBitsFor(baseBits: number, bodyBytes: number): number {
  return baseBits + Math.max(0, Math.ceil(Math.log2(bodyBytes / (64 * 1024))));
}
