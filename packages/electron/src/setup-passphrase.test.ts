import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EFF_WORDS } from './eff-wordlist.js';
import { newPassphrase, normalisePassphrase } from './setup-passphrase.js';

test('the wordlist is the EFF long list without hyphenated words', () => {
  assert.ok(EFF_WORDS.length > 7700 && EFF_WORDS.length <= 7776);
  assert.equal(new Set(EFF_WORDS).size, EFF_WORDS.length);
  assert.ok(EFF_WORDS.every((w) => /^[a-z]+$/.test(w)));
});

test('a passphrase is five list words joined by dashes', () => {
  const p = newPassphrase();
  const words = p.split('-');
  assert.equal(words.length, 5);
  assert.ok(words.every((w) => EFF_WORDS.includes(w)));
});

test('words are picked with the given picker over the whole list', () => {
  const seen: number[] = [];
  newPassphrase((n) => { seen.push(n); return n - 1; });
  assert.deepEqual(seen, Array(5).fill(EFF_WORDS.length));
  assert.equal(newPassphrase(() => 0), Array(5).fill(EFF_WORDS[0]).join('-'));
});

test('typed passphrases are normalised: case, spaces, any separators', () => {
  assert.equal(normalisePassphrase('Abacus Abdomen  abdominal_ABIDE,abiding'), 'abacus-abdomen-abdominal-abide-abiding');
  assert.equal(normalisePassphrase('  abacus-abdomen-abdominal-abide-abiding\n'), 'abacus-abdomen-abdominal-abide-abiding');
  assert.equal(normalisePassphrase(''), '');
});
