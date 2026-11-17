// packages/mailbox/src/server/sealed-check.ts
/**
 * The relay can't open what it holds, but it can refuse what plainly isn't sealed. AES-256-GCM
 * output looks like random bytes: every byte value about equally often, nothing to compress. Text,
 * files and base64 inside base64 don't. This keeps readable content off the relay; something sealed
 * with someone else's key, or packed so it hides its format, still passes (no relay can tell that
 * apart, by design): this refuses the plain and the lazy, not the determined.
 */
import { deflateRawSync } from 'node:zlib';

/** Below this the counts are too thin to judge; tiny uploads pass (nonce + tag is 28 bytes). */
const MIN_JUDGED = 2048;
/**
 * Chi-square over 256 byte values (255 degrees of freedom: mean 255, sd ~22.6). Random data goes
 * over 420 about once in a billion uploads; text scores in the hundreds of thousands.
 */
const MAX_CHI_SQUARE = 420;
/** Deflate a sample: random bytes never shrink, anything with patterns does */
const SAMPLE_BYTES = 64 * 1024;
const MIN_KEPT = 0.99;
/**
 * Strong compressors (xz, zip, zstd...) also look random but open with any archive tool, so their
 * file signatures are refused at the start. A sealed upload starts with its random nonce: one of
 * these turns up by chance about once in 8 million uploads, and the app's next push re-seals it.
 */
const SIGNATURES = [
  [0x1f, 0x8b, 0x08],                           // gzip
  [0x50, 0x4b, 0x03, 0x04],                     // zip (and docx, apk, jar...)
  [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],         // xz
  [0x28, 0xb5, 0x2f, 0xfd],                     // zstd
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],         // 7z
  [0x42, 0x5a, 0x68],                           // bzip2
  [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07],         // rar
  [0x77, 0x4f, 0x46, 0x32],                     // woff2
].map((m) => Buffer.from(m));

export function looksSealed(b: Buffer): boolean {
  if (b.length < 28) return false;
  if (SIGNATURES.some((m) => b.subarray(0, m.length).equals(m))) return false;
  if (b.length < MIN_JUDGED) return true;
  const counts = new Uint32Array(256);
  for (let i = 0; i < b.length; i++) counts[b[i]]++;
  const expected = b.length / 256;
  let chi = 0;
  for (let v = 0; v < 256; v++) { const d = counts[v] - expected; chi += d * d / expected; }
  if (chi > MAX_CHI_SQUARE) return false;
  const sample = b.subarray(0, SAMPLE_BYTES);
  return deflateRawSync(sample, { level: 1 }).length >= sample.length * MIN_KEPT;
}
