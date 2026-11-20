/** Knock codes: 8 Crockford base32 characters (40 bits), shown XXXX-XXXX. */
import { randomBytes } from 'node:crypto';

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 8;

/** 256 is a multiple of 32, so `byte & 31` has no bias. */
export function newCode(rand: (n: number) => Buffer = randomBytes): string {
  const bytes = rand(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] & 31];
  return out;
}

/** What someone typed → the code, or null. Case, spaces and dashes ignored; O→0, I/L→1. */
export function normaliseCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (c.length !== CODE_LENGTH) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
