import { expect, test } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readLines } from '../src/lines.js';
import { nodePlatform } from '../src/node/index.js';

const P = nodePlatform();
const file = (text: string) => { const f = path.join(mkdtempSync(path.join(tmpdir(), 'lines-')), 'f.ndjson'); writeFileSync(f, text); return f; };
const all = async (f: string, size: number) => { const out: string[] = []; for await (const l of readLines(P, f, size)) out.push(l); return out; };

test('lines split across chunks come out whole, multi-byte titles included', async () => {
  const lines = Array.from({ length: 300 }, (_, i) => JSON.stringify({ i, t: `Amélie €${i} 😀` }));
  const f = file(lines.join('\n') + '\n');
  for (const size of [1, 7, 64, 4096]) expect(await all(f, size)).toEqual(lines);
});

test('a last line without a newline is kept; CRLF is trimmed; no empty tail', async () => {
  expect(await all(file('a\r\nb\nc'), 2)).toEqual(['a', 'b', 'c']);
  expect(await all(file('a\n'), 3)).toEqual(['a']);
  expect(await all(file(''), 3)).toEqual([]);
});
