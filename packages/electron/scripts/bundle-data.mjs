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
if (entries.length) await build({
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

// The mailbox IPC imports @sbtltv/mailbox (workspace TypeScript): bundle it like the data process.
// Its imports of this package's own modules (../x.js) stay imports, so main and the mailbox share
// one copy of setup-transfer and friends.
if (existsSync('src/mailbox/mailbox-ipc.ts')) {
  await build({
    entryPoints: ['src/mailbox/mailbox-ipc.ts'],
    outdir: 'dist/mailbox',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    sourcemap: true,
    external: ['electron'],
    plugins: [{
      name: 'own-modules-external',
      // Either slash: esbuild gives Windows paths with backslashes
      setup(b) { b.onResolve({ filter: /^\.\.\// }, (args) => (/[\\/]src[\\/]mailbox[\\/]/.test(args.importer) ? { path: args.path, external: true } : undefined)); },
    }],
    logLevel: 'warning',
  });
}

// Guard: the bundle must import this package's own modules, never carry its own copy of them (a
// second settings store on the same file). Fails the build if the plugin above stopped matching.
if (existsSync('dist/mailbox/mailbox-ipc.js')) {
  const { readFileSync } = await import('node:fs');
  const out = readFileSync('dist/mailbox/mailbox-ipc.js', 'utf8');
  if (out.includes('new Store(') || out.includes('electron-store')) {
    console.error('bundle-data: dist/mailbox/mailbox-ipc.js contains its own settings store; the own-modules plugin did not apply');
    process.exit(1);
  }
}
