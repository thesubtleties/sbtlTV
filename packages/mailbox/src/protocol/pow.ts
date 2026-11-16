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

/**
 * Bigger bodies cost more: one extra bit (twice the work) per doubling above 64 KB, and another
 * per doubling above 512 KB. A real send (~1 KB) pays the base; a large file playlist (~300 KB)
 * about 8x; a full 2 MB about 128x, which makes bulk use slow and costly.
 */
export function powBitsFor(baseBits: number, bodyBytes: number): number {
  const over = (from: number) => Math.max(0, Math.ceil(Math.log2(bodyBytes / from)));
  return baseBits + over(64 * 1024) + over(512 * 1024);
}

/** This computer's hashes per second for proofs (a ~30 ms sample). */
export function measurePowRate(): number {
  const input = powInput('/rate', '', 0, '0');
  const start = performance.now();
  let n = 0;
  while (performance.now() - start < 30) { for (let i = 0; i < 1000; i++) checkPow(input, String(n++), 64); }
  return n / ((performance.now() - start) / 1000);
}

/**
 * Seconds a proof of `bits` may take here, padded for bad luck: the work is random, and 3x the
 * average covers about 95 % of tries.
 */
export function powSecondsUpTo(bits: number, hashesPerSecond: number): number {
  return Math.ceil((3 * 2 ** bits) / Math.max(1, hashesPerSecond));
}

/** The level a new proof needs right now (on every reply, and from GET /v1/hello). */
export const LEVEL_HEADER = 'x-sbtltv-pow-level';

/**
 * The same search in slices, giving way between them, so the app stays responsive while it works
 * (a big setup can take a minute at its difficulty).
 */
export async function solvePowAsync(input: string, bits: number, slice = 20_000, start = randomInt(0, 2 ** 47)): Promise<string> {
  let i = start;
  for (;;) {
    for (const end = i + slice; i < end; i++) {
      const nonce = String(i);
      if (checkPow(input, nonce, bits)) return nonce;
    }
    await new Promise<void>((r) => setImmediate(r));
  }
}

/** The server's clock (ms), on every reply: proofs carry the server's minute, not a wrong local one. */
export const TIME_HEADER = 'x-sbtltv-time';
