const path = require('node:path');
const fs = require('node:fs');

if (process.platform !== 'linux') {
  console.log('[native] Skip GStreamer helper copy on non-Linux');
  process.exit(0);
}

const source = path.join(__dirname, '..', 'gst-player', 'gst-player');
const targetDir = path.join(__dirname, '..', 'dist', 'gst-player');
const target = path.join(targetDir, 'gst-player');

if (!fs.existsSync(source)) {
  console.warn('[gst] gst-player not found; run pnpm gst-helper:build first');
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
fs.chmodSync(target, 0o755);
console.log('[gst] Copied gst-player to dist/gst-player');
