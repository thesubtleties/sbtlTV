const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

if (process.platform !== 'linux') {
  console.log('[native] Skip libmpv build on non-Linux');
  process.exit(0);
}

const mpvDir = path.join(__dirname, '..', 'native', 'mpv');
const builtNode = path.join(mpvDir, 'build', 'Release', 'mpv.node');

if (process.env.SBTLTV_SKIP_NATIVE_BUILD === '1' && fs.existsSync(builtNode)) {
  console.log('[native] Skip libmpv build (SBTLTV_SKIP_NATIVE_BUILD=1)');
  process.exit(0);
}

execFileSync('node-gyp', [
  'rebuild',
  '--directory',
  mpvDir,
  '--runtime=electron',
  '--target=40.0.0',
  '--dist-url=https://electronjs.org/headers',
], { stdio: 'inherit' });
