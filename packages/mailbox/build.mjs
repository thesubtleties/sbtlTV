// The server as one file for the image (no node_modules inside it)
import { build } from 'esbuild';
await build({ entryPoints: ['src/server/main.ts'], outfile: 'dist/main.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'warning' });
