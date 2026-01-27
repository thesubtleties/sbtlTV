const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'linux') {
  console.log('[native] Skip libmpv copy on non-Linux');
  process.exit(0);
}

const source = path.join(__dirname, '..', 'native', 'mpv', 'build', 'Release', 'mpv.node');
const targetDir = path.join(__dirname, '..', 'dist', 'native');
const target = path.join(targetDir, 'mpv.node');

if (!fs.existsSync(source)) {
  console.warn('[native] mpv.node not found; run pnpm native:build first');
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log('[native] Copied mpv.node to dist/native');
