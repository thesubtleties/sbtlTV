// The server as one file for the image (no node_modules inside it)
import { build } from 'esbuild';
await build({
  entryPoints: ['src/server/main.ts'], outfile: 'dist/main.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'warning',
  // pg's optional native binding is never installed
  external: ['pg-native'],
  // pg is CommonJS and require()s Node built-ins: give the ESM bundle a require
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
