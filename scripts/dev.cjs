#!/usr/bin/env node

const { spawn } = require('node:child_process');

const isWindows = process.platform === 'win32';

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

  const env = { ...process.env };

  electron = spawn('pnpm', ['--filter', '@sbtltv/electron', 'dev'], {
    stdio: 'inherit',
    shell: isWindows,
    env,
  });

  electron.on('exit', (code) => {
    shutdown(code ?? 0);
  });
})();
