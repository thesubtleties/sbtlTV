const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const rootDir = path.join(__dirname, '..');
const gstHelper = path.join(rootDir, 'gst-player', 'gst-player');

const forceBuild = process.env.SBTLTV_FORCE_GST_BUILD === '1';
const forceCopy = process.env.SBTLTV_FORCE_GST_COPY === '1';
const skipBuild = !forceBuild && (process.env.SBTLTV_SKIP_GST_BUILD === '1' || fs.existsSync(gstHelper));
const skipCopy = !forceCopy && process.env.SBTLTV_SKIP_GST_COPY === '1';
const execEnv = { ...process.env };
delete execEnv.LD_PRELOAD;

if (!skipBuild) {
  execFileSync('pnpm', ['gst-helper:build'], { stdio: 'inherit', env: execEnv });
} else {
  console.log('[gst] Skip helper build');
}

if (!skipCopy) {
  execFileSync('pnpm', ['gst-helper:copy'], { stdio: 'inherit', env: execEnv });
} else {
  console.log('[gst] Skip helper copy');
}

execFileSync('electron', ['--ozone-platform=x11', '--ozone-platform-hint=x11', '.', '--dev'], { stdio: 'inherit' });
