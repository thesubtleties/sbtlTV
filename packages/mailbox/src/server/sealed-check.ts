// packages/mailbox/src/server/sealed-check.ts
/**
 * The relay can't open what it holds, but it can refuse what plainly isn't sealed. AES-256-GCM
 * output looks like random bytes: every byte value about equally often, nothing to compress. Text,
 * documents, images, base64 and common archives don't. This keeps readable content off the relay.
 * It is not the defence against file hosting: video and archives packed to hide their format look
 * random too (as does anything sealed with someone else's key), and no relay can tell those apart.
 * The per-version download limit (limits.ts Downloads) is what makes the relay a poor file host.
 */
import { deflateRawSync } from 'node:zlib';
import { SEAL_OVERHEAD } from '../protocol/index.js';

/** Below this the counts are too thin to judge; tiny uploads pass. */
const MIN_JUDGED = 2048;
/**
 * Chi-square over 256 byte values (255 degrees of freedom: mean 255, sd ~22.6). Random data goes
 * over 420 about once in 3 billion uploads at box sizes, about once in 300 million at 2 KB; text
 * scores in the hundreds of thousands.
 */
const MAX_CHI_SQUARE = 420;
/** Deflate a sample: random bytes never shrink, anything with patterns does */
const SAMPLE_BYTES = 64 * 1024;
const MIN_KEPT = 0.99;
/**
 * Strong compressors also look random but open with any archive tool, so their file signatures are
 * refused at the start (null = any byte). A sealed upload starts with its random nonce: one of these
 * turns up by chance about once in 8 million uploads; a refused box goes again with the next pull,
 * a refused send once more.
 */
const SIGNATURES: (number | null)[][] = [
  [0x1f, 0x8b, 0x08],                           // gzip
  [0x50, 0x4b, 0x03, 0x04],                     // zip (and docx, apk, jar...)
  [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],         // xz
  [0x5d, 0x00, 0x00, null, 0x00],               // lzma (alone)
  [0x4c, 0x5a, 0x49, 0x50],                     // lzip
  [0x28, 0xb5, 0x2f, 0xfd],                     // zstd
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],         // 7z
  [0x42, 0x5a, 0x68],                           // bzip2
  [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07],         // rar
  [0x77, 0x4f, 0x46, 0x32],                     // woff2
];
const startsWith = (b: Buffer, sig: (number | null)[]) => b.length >= sig.length && sig.every((v, i) => v === null || b[i] === v);

export function looksSealed(b: Buffer): boolean {
  if (b.length < SEAL_OVERHEAD) return false;
  if (SIGNATURES.some((sig) => startsWith(b, sig))) return false;
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

/**
 * Short sealed values (a computer's new key: 124 bytes) are too small to judge by counts, but
 * random bytes are printable ASCII only 37% of the time on average; past 70% is text (7.6
 * standard deviations at 124 bytes: a real key is taken for text about once in 10^13).
 */
export function mostlyText(b: Buffer): boolean {
  let printable = 0;
  for (const v of b) if (v >= 0x20 && v < 0x7f) printable++;
  return printable > b.length * 0.7;
}
