// Bundles the data process entries (and the data-layer tests) with esbuild.
//
// tsc cannot emit the workspace TypeScript packages (@sbtltv/core,
// @sbtltv/local-adapter) that the data process imports at runtime, so those two
// entries are bundled into self-contained files. The tests under src/data/ are
// bundled for the same reason: node --test loads them straight from dist/data/.
import { build } from 'esbuild';
import { existsSync, readdirSync } from 'node:fs';

const entries = ['src/data/data-process.ts', 'src/data/sync-worker.ts'].filter(existsSync);
if (existsSync('src/data')) {
  for (const f of readdirSync('src/data')) {
    if (f.endsWith('.test.ts')) entries.push(`src/data/${f}`);
  }
}
if (entries.length === 0) process.exit(0);

await build({
  entryPoints: entries,
  outdir: 'dist/data',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'warning',
});
