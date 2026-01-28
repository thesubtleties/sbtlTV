const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'linux') {
  console.log('[gst] Skip helper build on non-Linux');
  process.exit(0);
}

const repoRoot = path.join(__dirname, '..', '..', '..');
const script = path.join(repoRoot, 'scripts', 'build-gst-player.sh');

execFileSync('bash', [script], { stdio: 'inherit' });
