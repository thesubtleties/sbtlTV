const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const rootDir = path.join(__dirname, '..');
const mpvNode = path.join(rootDir, 'native', 'mpv', 'build', 'Release', 'mpv.node');

const forceBuild = process.env.SBTLTV_FORCE_NATIVE_BUILD === '1';
const forceCopy = process.env.SBTLTV_FORCE_NATIVE_COPY === '1';
const skipBuild = !forceBuild && (process.env.SBTLTV_SKIP_NATIVE_BUILD === '1' || fs.existsSync(mpvNode));
const skipCopy = !forceCopy && process.env.SBTLTV_SKIP_NATIVE_COPY === '1';
const execEnv = { ...process.env };
delete execEnv.LD_PRELOAD;

if (!skipBuild) {
  execFileSync('pnpm', ['native:build'], { stdio: 'inherit', env: execEnv });
} else {
  console.log('[native] Skip libmpv build');
}

if (!skipCopy) {
  execFileSync('pnpm', ['native:copy'], { stdio: 'inherit', env: execEnv });
} else {
  console.log('[native] Skip libmpv copy');
}

execFileSync('electron', ['--ozone-platform-hint=auto', '.', '--dev'], { stdio: 'inherit' });
