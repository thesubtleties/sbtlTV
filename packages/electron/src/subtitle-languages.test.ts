import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SUBTITLE_LANGUAGES, languageByCode, subdlCode, BASIC_LANGUAGE_CODES } from './subtitle-languages.js';

test('codes are unique, lowercase, and include the basic three', () => {
  const codes = SUBTITLE_LANGUAGES.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of codes) assert.equal(c, c.toLowerCase());
  for (const b of BASIC_LANGUAGE_CODES) assert.ok(codes.includes(b));
});

test('every language maps to mpv ISO 639-2 codes', () => {
  for (const l of SUBTITLE_LANGUAGES) assert.ok(l.iso.length > 0, l.code);
  assert.deepEqual(languageByCode('pt-br')?.iso, ['por']);
});

test('subdlCode: known -> SubDL code, unknown/auto -> null', () => {
  assert.equal(subdlCode('en'), languageByCode('en')!.subdl);
  assert.equal(subdlCode('auto'), null);
  assert.equal(subdlCode('xx'), null);
});
