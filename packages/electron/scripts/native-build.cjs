const { execFileSync } = require('node:child_process');
const path = require('node:path');

if (process.platform !== 'linux') {
  console.log('[native] Skip libmpv build on non-Linux');
  process.exit(0);
}

const mpvDir = path.join(__dirname, '..', 'native', 'mpv');

execFileSync('node-gyp', [
  'rebuild',
  '--directory',
  mpvDir,
  '--runtime=electron',
  '--target=40.0.0',
  '--dist-url=https://electronjs.org/headers',
], { stdio: 'inherit' });
