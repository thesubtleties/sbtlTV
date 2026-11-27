import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const SRC = new URL('../src/', import.meta.url).pathname;
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? (f === 'node' ? [] : files(p)) : p.endsWith('.ts') ? [p] : []; });
}

test('shared code imports no Node or Electron module (src/node/ is the only exception)', () => {
  const bad = files(SRC).filter((f) => /from\s+['"](node:[^'"]+|electron)['"]/.test(readFileSync(f, 'utf8')));
  expect(bad).toEqual([]);
});
