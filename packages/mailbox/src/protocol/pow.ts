/**
 * Hashcash-style proof-of-work: SHA-256(input ‖ nonce) starts with `bits` zero bits. The input
 * binds the app version, the route, the exact body and a challenge the server issued (unguessable,
 * valid 15 minutes), so a proof can't be reused elsewhere, made ahead of time or saved up, and a
 * home-made script has to keep claiming a current version. 20 bits ≈ 1 M hashes ≈ a second in Node.
 */
import { createHash, randomInt } from 'node:crypto';

export const POW_HEADER = 'x-sbtltv-pow';

export function powInput(route: string, body: string, challenge: string, version: string): string {
  return `sbtl-pow2|${version}|${challenge}|${route}|${createHash('sha256').update(body).digest('hex')}|`;
}

/** Every reply carries a fresh challenge (and GET /v1/hello returns one); a proof uses one. */
export const CHALLENGE_HEADER = 'x-sbtltv-challenge';
export const CHALLENGE_TTL_MS = 15 * 60_000;
/** The difficulty a refused proof needed. */
export const POW_BITS_HEADER = 'x-sbtltv-pow-bits';
/** The most a request's size adds: 2 MB costs 32x the base. */
export const MAX_SIZE_BITS = 5;

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

/** Starts at a random point, so two people solving the same input never send the same proof. Tests only; the app uses solvePowAsync. */
export function solvePow(input: string, bits: number): string {
  for (let i = randomInt(0, 2 ** 47); ; i++) {
    const nonce = String(i);
    if (checkPow(input, nonce, bits)) return nonce;
  }
}

/**
 * Bigger bodies cost more: one extra bit (twice the work) per doubling above 64 KB, at most
 * MAX_SIZE_BITS. A real send (~1 KB) pays the base; a large file playlist (~300 KB) about 8x; the
 * largest (2 MB) 32x, about half a minute. Bulk use is held back by the large-drop budget instead.
 */
export function powBitsFor(baseBits: number, bodyBytes: number): number {
  return baseBits + Math.min(MAX_SIZE_BITS, Math.max(0, Math.ceil(Math.log2(bodyBytes / (64 * 1024)))));
}

/** This computer's hashes per second for proofs (a ~30 ms sample). */
export function measurePowRate(): number {
  const input = powInput('/rate', '', 'rate', '0');
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
export async function solvePowAsync(input: string, bits: number, slice = 20_000, start = randomInt(0, 2 ** 47), stopped: () => boolean = () => false): Promise<string> {
  let i = start;
  for (;;) {
    if (stopped()) throw new Error('stopped');
    for (const end = i + slice; i < end; i++) {
      const nonce = String(i);
      if (checkPow(input, nonce, bits)) return nonce;
    }
    await new Promise<void>((r) => setImmediate(r));
  }
}

/** The server's clock (ms), on every reply: proofs carry the server's minute, not a wrong local one. */
export const TIME_HEADER = 'x-sbtltv-time';
