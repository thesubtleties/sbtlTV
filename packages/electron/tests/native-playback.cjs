// Run after pnpm build on a graphical Linux/macOS session with ffmpeg installed.
// Uses an isolated profile and generated video with subtitles; no provider data.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, dialog } = require('electron');

const directory = mkdtempSync('/tmp/sbtltv-playback-');
app.setPath('userData', directory);
app.setPath('sessionData', directory);
app.setAppLogsPath(join(directory, 'logs'));
writeFileSync(join(directory, 'sbtltv-config.json'), JSON.stringify({ settings: { autoUpdateEnabled: false } }));
const media = join(directory, 'subtitles.mkv');
writeFileSync(join(directory, 'subtitles.srt'), '1\n00:00:00,000 --> 00:01:00,000\nSubtitle allocator regression\n');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=640x360:r=24:d=60',
  '-i', join(directory, 'subtitles.srt'), '-map', '0:v', '-map', '1:s', '-c:v', 'libx264',
  '-preset', 'ultrafast', '-c:s', 'srt', '-disposition:s:0', 'default', media]);

let prompts = 0;
dialog.showMessageBox = async (...args) => {
  const options = args.at(-1);
  assert.equal(options.title, 'Native video playback failed');
  prompts++;
  return { response: options.buttons.indexOf('Reset Native Playback') };
};

async function until(check, description) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}

async function readyWindow(previous) {
  let window;
  await until(async () => {
    window = BrowserWindow.getAllWindows().find(candidate => candidate !== previous);
    if (!window || window.webContents.isLoading()) return false;
    return window.webContents.executeJavaScript(`!!window.mpv && document.body.innerText.includes('All Channels')`);
  }, 'guide ready');
  await until(async () => (await window.webContents.executeJavaScript('window.mpv.getMode()')).mode === 'native', 'native mode');
  if (previous) await until(async () => !(await window.webContents.executeJavaScript('window.mpv.getStatus()')).playing, 'reset playback stopped');
  return window;
}

async function selectChannel(window) {
  await window.webContents.executeJavaScript(`(() => {
    const channel = [...document.querySelectorAll('*')].find(element => element.textContent === 'Subtitle test');
    if (!channel) throw new Error('Test channel missing');
    channel.click();
  })()`);
}

async function assertRedVideo(window) {
  await until(async () => {
    const bounds = await window.webContents.executeJavaScript(`(() => {
      const canvas = [...document.querySelectorAll('canvas')].find(canvas => canvas.getBoundingClientRect().width > 0);
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), width: 1, height: 1 };
    })()`);
    if (!bounds) return false;
    const [blue, green, red, alpha] = (await window.webContents.capturePage(bounds)).toBitmap();
    return red > 200 && green < 30 && blue < 30 && alpha === 255;
  }, 'displayed red video');
}

async function loseContext(window, restore) {
  await window.webContents.executeJavaScript(`(() => {
    const canvas = [...document.querySelectorAll('canvas')].find(canvas => canvas.getBoundingClientRect().width > 0);
    const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
    extension.loseContext();
    ${restore ? 'setTimeout(() => extension.restoreContext(), 500);' : ''}
  })()`);
}

async function run() {
  await import(pathToFileURL(join(__dirname, '../dist/main.js')).href);
  let window = await readyWindow();
  if (process.argv.includes('--fail-initialization')) {
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Page.enable');
    await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: `const originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          return type === 'webgl2' ? null : originalGetContext.call(this, type, ...args);
        };`,
    });
  }
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const request = indexedDB.open('sbtltv');
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('channels', 'readwrite');
      transaction.objectStore('channels').put({ stream_id: 'subtitle-test', name: 'Subtitle test',
        stream_icon: '', epg_channel_id: '', category_ids: [], source_id: 'test', direct_url: ${JSON.stringify(media)} });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  })`);
  window.webContents.reload();
  window = await readyWindow();
  await delay(500);
  assert.equal(prompts, 0, 'idle guide must not report WebGL initialization failure');
  await selectChannel(window);
  if (process.argv.includes('--fail-initialization')) {
    const previous = window;
    window = await readyWindow(previous);
    assert.equal(prompts, 1);
    assert.equal((await window.webContents.executeJavaScript('window.mpv.getStatus()')).playing, false);
    await selectChannel(window);
    await assertRedVideo(window);
  } else {
    await assertRedVideo(window);
    await loseContext(window, true);
    await delay(6500);
    assert.equal(prompts, 0, 'restored context must not trigger reset');
    await assertRedVideo(window);
    for (let attempt = 0; attempt < 3; attempt++) {
      await window.webContents.executeJavaScript('window.mpv.setVolume(37)');
      const status = await window.webContents.executeJavaScript('window.mpv.getStatus()');
      if (!status.muted) await window.webContents.executeJavaScript('window.mpv.toggleMute()');
      await delay(200);
      const previous = window;
      await loseContext(window, false);
      window = await readyWindow(previous);
      assert.equal(prompts, attempt + 1);
      const resetStatus = await window.webContents.executeJavaScript('window.mpv.getStatus()');
      assert.equal(resetStatus.playing, false);
      assert.equal(resetStatus.volume, 37);
      assert.equal(resetStatus.muted, true);
      await selectChannel(window);
      await assertRedVideo(window);
    }
  }
  console.log('PASS: subtitle video pixels and native recovery', { prompts, electron: process.versions.electron });
  app.exit(0);
}

const deadline = setTimeout(() => { console.error('Playback test timed out'); app.exit(1); }, 90000);
app.on('will-quit', () => clearTimeout(deadline));
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
run().catch(error => { console.error(error); app.exit(1); });
