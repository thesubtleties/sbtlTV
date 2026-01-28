#!/usr/bin/env node

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForUrl(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok || res.status) return;
    } catch {
      // ignore
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

let shuttingDown = false;
let electron = null;

const vite = spawn('pnpm', ['--filter', '@sbtltv/ui', 'dev'], {
  stdio: 'inherit',
  shell: isWindows,
});

const shutdown = (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (electron && !electron.killed) electron.kill('SIGTERM');
  if (!vite.killed) vite.kill('SIGTERM');
  process.exit(code ?? 0);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

vite.on('exit', (code) => {
  if (shuttingDown) return;
  console.error(`[dev] Vite exited with code ${code ?? 'null'}`);
  shutdown(code ?? 1);
});

(async () => {
  try {
    await waitForUrl('http://localhost:5173', 20000);
  } catch (error) {
    console.error(`[dev] ${error instanceof Error ? error.message : 'Vite wait failed'}`);
    shutdown(1);
    return;
  }

  const distLibDir = path.join(__dirname, '..', 'packages', 'electron', 'dist', 'native', 'lib');
  const preloadLibs = (() => {
    if (process.env.SBTLTV_PRELOAD_FFMPEG === '0') return null;
    if (!fs.existsSync(distLibDir)) return null;
    const libs = [
      'libavutil.so.60',
      'libavcodec.so.62',
      'libavformat.so.62',
      'libswresample.so.6',
      'libswscale.so.9',
    ];
    const resolved = libs.map((lib) => path.join(distLibDir, lib)).filter((lib) => fs.existsSync(lib));
    if (!resolved.length) return null;
    return resolved.join(':');
  })();

  const env = { ...process.env };
  if (preloadLibs && !isWindows) {
    env.LD_PRELOAD = env.LD_PRELOAD ? `${preloadLibs}:${env.LD_PRELOAD}` : preloadLibs;
    console.log('[dev] LD_PRELOAD set for bundled FFmpeg libs');
  }
  if (isLinux && fs.existsSync(distLibDir)) {
    env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH ? `${distLibDir}:${env.LD_LIBRARY_PATH}` : distLibDir;
    console.log('[dev] LD_LIBRARY_PATH set for bundled FFmpeg libs');
  }

  electron = spawn('pnpm', ['--filter', '@sbtltv/electron', 'dev'], {
    stdio: 'inherit',
    shell: isWindows,
    env,
  });

  electron.on('exit', (code) => {
    shutdown(code ?? 0);
  });
})();
