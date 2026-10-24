import { randomInt } from 'node:crypto';
import { EFF_WORDS } from './eff-wordlist.js';

/** Five words from the EFF long list (about 64 bits), e.g. "abacus-abdomen-abide-acorn-actor". */
export function newPassphrase(pick: (n: number) => number = randomInt): string {
  return Array.from({ length: 5 }, () => EFF_WORDS[pick(EFF_WORDS.length)]).join('-');
}

/** What the user typed, as the passphrase: lowercase words joined by dashes, whatever separated them. */
export function normalisePassphrase(input: string): string {
  return input.toLowerCase().split(/[^a-z]+/).filter(Boolean).join('-');
}
