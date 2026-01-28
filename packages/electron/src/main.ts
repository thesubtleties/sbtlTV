import { app, BrowserWindow, ipcMain, net as electronNet, dialog, screen } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import type { Source } from '@sbtltv/core';
import * as storage from './storage.js';
import { initLogging, log } from './logger.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimum window dimensions
const MIN_WIDTH = 640;
const MIN_HEIGHT = 620;

initLogging('main');
process.on('uncaughtException', (error) => log('error', 'process', 'uncaughtException', error));
process.on('unhandledRejection', (reason) => log('error', 'process', 'unhandledRejection', reason));

const normalizeVsyncMode = (value?: string | null): 'on' | 'off' | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'on' || normalized === 'off') return normalized;
  return null;
};

if (process.platform === 'linux') {
  const vsyncMode = normalizeVsyncMode(process.env.SBTLTV_VSYNC);
  if (vsyncMode === 'off') {
    process.env.vblank_mode = '0';
    process.env.__GL_SYNC_TO_VBLANK = '0';
    app.commandLine.appendSwitch('disable-gpu-vsync');
    log('info', 'window', 'vsync', { mode: 'off' });
  } else if (vsyncMode === 'on') {
    process.env.vblank_mode = '1';
    process.env.__GL_SYNC_TO_VBLANK = '1';
    log('info', 'window', 'vsync', { mode: 'on' });
  }
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('ozone-platform-hint', 'x11');
  log('info', 'window', 'force-x11', { ozone: 'x11' });
}

let mainWindow: BrowserWindow | null = null;
let mpvProcess: ChildProcess | null = null;
let mpvSocket: net.Socket | null = null;
let gstProcess: ChildProcess | null = null;
let gstBuffer = '';
let gstReady = false;
let gstRequestId = 0;
const gstPendingRequests = new Map<number, { resolve: (data: { success?: boolean; error?: string }) => void; reject: (err: Error) => void }>();
let gstResizeHandler: (() => void) | null = null;
let gstStderrTail: string[] = [];
const GST_STDERR_TAIL_MAX = 6;
interface GstViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  hidden?: boolean;
}

let gstLastRect: { x: number; y: number; width: number; height: number; scale: number } | null = null;
let gstViewport: GstViewport | null = null;
const gstUseAppsink = process.platform === 'linux';
let gstFrameServer: net.Server | null = null;
let gstFrameSocketPath: string | null = null;
let gstFrameBuffer = Buffer.alloc(0);
let gstLastVideoInfoKey = '';
let gstFrameSendScheduled = false;
let gstLatestFrame: { info: MpvFrameInfo; data: Buffer } | null = null;
let requestId = 0;
const pendingRequests = new Map<number, { resolve: (data: unknown) => void; reject: (err: Error) => void }>();

// Track mpv state
interface MpvState {
  playing: boolean;
  volume: number;
  muted: boolean;
  position: number;
  duration: number;
}

interface MpvFrameInfo {
  width: number;
  height: number;
  stride: number;
  format: 'RGBA';
  pts: number;
  frameId: number;
}

const mpvState: MpvState = {
  playing: false,
  volume: 100,
  muted: false,
  position: 0,
  duration: 0,
};

const isYoutubeUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host.endsWith('youtube.com') ||
      host.endsWith('youtu.be') ||
      host.endsWith('youtube-nocookie.com') ||
      host.endsWith('music.youtube.com');
  } catch {
    return false;
  }
};

const resolveYtdlMode = (url: string): 'yes' | 'no' => {
  const env = (process.env.SBTLTV_YTDL || '').toLowerCase();
  if (env === 'no' || env === '0' || env === 'false') return 'no';
  if (env === 'yes' || env === '1' || env === 'true') return 'yes';
  return isYoutubeUrl(url) ? 'yes' : 'no';
};

const envFlag = (value?: string): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const gstDebugEnabled = envFlag(process.env.SBTLTV_GST_DEBUG);

const sanitizeUrlForLog = (rawUrl: string): Record<string, string | number | boolean> => {
  try {
    const parsed = new URL(rawUrl);
    return {
      scheme: parsed.protocol.replace(':', ''),
      host: parsed.host,
      pathLength: parsed.pathname.length,
      hasQuery: parsed.search.length > 0,
    };
  } catch {
    return { scheme: 'invalid', host: '', pathLength: rawUrl.length, hasQuery: false };
  }
};

function pickYtdlpUrl(output: string): string | null {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  const m3u8Line = lines.find((line) => line.includes('m3u8'));
  return m3u8Line ?? lines[0];
}

async function resolveYtdlpUrl(url: string): Promise<{ url?: string; error?: string }> {
  const ytdlPath = process.env.SBTLTV_YTDL_PATH || 'yt-dlp';
  const args = [
    '-g',
    '--no-playlist',
    '--format',
    'best[protocol=m3u8_native]/best[protocol=m3u8]/best',
    url,
  ];

  return new Promise((resolve) => {
    const child = spawn(ytdlPath, args, { shell: false });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.on('error', (error: Error) => {
      const message = error.message || 'yt-dlp failed';
      if (message.includes('ENOENT')) {
        resolve({ error: 'yt-dlp not found (install it or set SBTLTV_YTDL_PATH)' });
        return;
      }
      resolve({ error: `yt-dlp failed: ${message}` });
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        const detail = stderr.trim() || 'yt-dlp exited with an error';
        resolve({ error: detail });
        return;
      }
      const resolvedUrl = pickYtdlpUrl(stdout);
      if (!resolvedUrl) {
        resolve({ error: 'yt-dlp returned no URL' });
        return;
      }
      resolve({ url: resolvedUrl });
    });
  });
}

async function resolveGstLoadUrl(url: string): Promise<{ url?: string; error?: string }> {
  const ytdlMode = resolveYtdlMode(url);
  if (ytdlMode !== 'yes') return { url };
  return resolveYtdlpUrl(url);
}

ipcMain.on('log-event', (_event, payload: { level?: string; tag?: string; args?: unknown[] }) => {
  const level = (payload.level || 'info') as 'error' | 'warn' | 'info' | 'debug' | 'trace';
  const tag = payload.tag || 'renderer';
  const args = Array.isArray(payload.args) ? payload.args : [];
  log(level, tag, ...args);
});

// Windows uses named pipes, Linux/macOS use Unix sockets
const SOCKET_PATH = process.platform === 'win32'
  ? `\\\\.\\pipe\\mpv-socket-${process.pid}`
  : `/tmp/mpv-socket-${process.pid}`;

// Throttle status updates to renderer (max once per 100ms)
let lastStatusUpdate = 0;
const STATUS_THROTTLE_MS = 100;
let lastGstStatusUpdate = 0;

async function createWindow(): Promise<void> {
  // Windows: transparent window so mpv shows through
  // Linux: opaque window, video renders via GstVideoOverlay
  const isWindows = process.platform === 'win32';
  const isLinux = process.platform === 'linux';
  const useTransparent = isWindows;
  const useFrameless = isWindows || isLinux;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    center: true,
    backgroundColor: useTransparent ? '#00000000' : '#000000',
    transparent: useTransparent,
    frame: !useFrameless, // Frameless on Windows/Linux (required for transparency)
    resizable: true, // Explicit for Electron 40
    show: true,
    icon: path.join(__dirname, '../assets/logo-white.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => log('info', 'window', 'ready-to-show'));
  mainWindow.on('show', () => log('info', 'window', 'show'));
  mainWindow.on('closed', () => log('info', 'window', 'closed'));

  const wc = mainWindow.webContents;
  wc.on('did-finish-load', () => log('info', 'window', 'did-finish-load', wc.getURL()));
  wc.on('did-fail-load', (_event, code, desc, url, isMainFrame) => {
    log('error', 'window', 'did-fail-load', { code, desc, url, isMainFrame });
  });
  wc.on('render-process-gone', (_event, details) => {
    log('error', 'window', 'render-process-gone', details);
  });
  wc.on('unresponsive', () => log('warn', 'window', 'unresponsive'));
  wc.on('responsive', () => log('info', 'window', 'responsive'));

  // Load the React app
  // In dev, load from Vite server; in prod, load from built files
  if (process.argv.includes('--dev')) {
    await mainWindow.loadURL('http://localhost:5173');
    if (process.env.OPEN_DEVTOOLS !== '0') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    // Packaged app: UI is in resources/ui, unpackaged: relative path
    const uiPath = app.isPackaged
      ? path.join(process.resourcesPath, 'ui', 'index.html')
      : path.join(__dirname, '../../ui/dist/index.html');
    await mainWindow.loadFile(uiPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    killMpv();
    killGst();
  });
}

function killMpv(): void {
  if (mpvSocket) {
    mpvSocket.destroy();
    mpvSocket = null;
  }
  if (mpvProcess) {
    mpvProcess.kill();
    mpvProcess = null;
  }
  // Clean up socket file (Unix only - Windows named pipes auto-cleanup)
  if (process.platform !== 'win32') {
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {
      // Ignore if already gone
    }
  }
}

function killGst(): void {
  if (gstProcess) {
    gstProcess.kill();
    gstProcess = null;
  }
  if (gstResizeHandler && mainWindow) {
    mainWindow.off('resize', gstResizeHandler);
  }
  gstResizeHandler = null;
  gstBuffer = '';
  gstReady = false;
  gstStderrTail = [];
  gstLastRect = null;
  gstViewport = null;
  stopFrameServer();
  for (const [id, pending] of gstPendingRequests) {
    pending.reject(new Error('GStreamer helper stopped'));
    gstPendingRequests.delete(id);
  }
}

function getGstHelperPath(): string | null {
  const packagedPath = path.join(process.resourcesPath, 'gst-player', 'gst-player');
  if (fs.existsSync(packagedPath)) return packagedPath;
  const distPath = path.join(__dirname, 'gst-player', 'gst-player');
  if (fs.existsSync(distPath)) return distPath;
  const devPath = path.join(__dirname, '../gst-player/gst-player');
  if (fs.existsSync(devPath)) return devPath;
  return null;
}

function handleGstStatus(line: string): void {
  const parts = line.split(' ');
  for (const part of parts.slice(1)) {
    const [key, rawValue] = part.split('=');
    if (!key) continue;
    switch (key) {
      case 'playing':
        mpvState.playing = rawValue === '1';
        break;
      case 'volume':
        mpvState.volume = Number.parseInt(rawValue ?? '0', 10) || 0;
        break;
      case 'muted':
        mpvState.muted = rawValue === '1';
        break;
      case 'position':
        mpvState.position = Number.parseFloat(rawValue ?? '0') || 0;
        break;
      case 'duration':
        mpvState.duration = Number.parseFloat(rawValue ?? '0') || 0;
        break;
      default:
        break;
    }
  }
  const now = Date.now();
  if (now - lastGstStatusUpdate > STATUS_THROTTLE_MS) {
    lastGstStatusUpdate = now;
    sendToRenderer('mpv-status', mpvState);
  }
}

function handleGstResult(line: string): void {
  const match = line.match(/^result\s+(\d+)\s+(ok|error)(?:\s+(.*))?$/);
  if (!match) return;
  const requestId = Number.parseInt(match[1], 10);
  const status = match[2];
  const message = match[3];
  const pending = gstPendingRequests.get(requestId);
  if (!pending) return;
  gstPendingRequests.delete(requestId);
  if (gstDebugEnabled) {
    log('debug', 'gst', 'result', { requestId, status, message });
  }
  if (status === 'ok') {
    pending.resolve({ success: true });
  } else {
    pending.resolve({ error: message || 'Unknown error' });
  }
}

function handleGstLine(line: string): void {
  if (line.startsWith('ready')) {
    gstReady = true;
    sendToRenderer('mpv-ready', true);
    return;
  }
  if (line.startsWith('status ')) {
    handleGstStatus(line);
    return;
  }
  if (line.startsWith('debug ')) {
    if (gstDebugEnabled) {
      log('debug', 'gst-helper', line.slice('debug '.length));
    }
    return;
  }
  if (line.startsWith('error ')) {
    if (gstDebugEnabled) {
      log('debug', 'gst-helper', 'error', line.slice('error '.length));
    }
    sendToRenderer('mpv-error', line.slice('error '.length));
    return;
  }
  if (line.startsWith('warning ')) {
    if (gstDebugEnabled) {
      log('debug', 'gst-helper', 'warning', line.slice('warning '.length));
    }
    sendToRenderer('mpv-warning', line.slice('warning '.length));
    return;
  }
  if (line.startsWith('result ')) {
    handleGstResult(line);
  }
}

function sendGstCommand(command: string, args: string[] = []): Promise<{ success?: boolean; error?: string }> {
  const process = gstProcess;
  const stdin = process?.stdin ?? null;
  if (!process || !stdin) {
    return Promise.resolve({ error: 'GStreamer helper not running' });
  }
  const id = ++gstRequestId;
  return new Promise((resolve, reject) => {
    gstPendingRequests.set(id, { resolve, reject });
    try {
      const payload = [command, id.toString(), ...args].join(' ') + '\n';
      if (gstDebugEnabled) {
        log('debug', 'gst', 'command', { id, command, args });
      }
      stdin.write(payload);
    } catch (error) {
      gstPendingRequests.delete(id);
      reject(error instanceof Error ? error : new Error('Failed to write to GStreamer helper'));
      return;
    }
    setTimeout(() => {
      if (gstPendingRequests.has(id)) {
        gstPendingRequests.delete(id);
        reject(new Error('GStreamer command timeout'));
      }
    }, 5000);
  });
}

let gstRectUpdateCount = 0;
let gstRectUpdateTimer: NodeJS.Timeout | null = null;

function noteGstRectUpdate(): void {
  if (!gstDebugEnabled) return;
  gstRectUpdateCount += 1;
  if (gstRectUpdateTimer) return;
  gstRectUpdateTimer = setTimeout(() => {
    log('debug', 'gst', 'rect-rate', { updates: gstRectUpdateCount });
    gstRectUpdateCount = 0;
    gstRectUpdateTimer = null;
  }, 1000);
}

function sendGstRect(): void {
  if (gstUseAppsink) return;
  if (!mainWindow || !gstProcess) return;
  const bounds = mainWindow.getContentBounds();
  const display = screen.getDisplayMatching(mainWindow.getBounds());
  const scale = display?.scaleFactor || 1;
  let x = 0;
  let y = 0;
  let width = bounds.width;
  let height = bounds.height;

  if (gstViewport) {
    if (gstViewport.hidden || gstViewport.width <= 0 || gstViewport.height <= 0) {
      x = -20000;
      y = -20000;
      width = 1;
      height = 1;
    } else {
      x = Math.max(0, Math.round(gstViewport.x));
      y = Math.max(0, Math.round(gstViewport.y));
      width = Math.max(1, Math.round(gstViewport.width));
      height = Math.max(1, Math.round(gstViewport.height));
      const maxWidth = Math.max(1, bounds.width - x);
      const maxHeight = Math.max(1, bounds.height - y);
      width = Math.min(width, maxWidth);
      height = Math.min(height, maxHeight);
    }
  }

  const scaledX = Math.round(x * scale);
  const scaledY = Math.round(y * scale);
  const scaledWidth = Math.max(1, Math.round(width * scale));
  const scaledHeight = Math.max(1, Math.round(height * scale));

  if (gstLastRect && gstLastRect.x === scaledX && gstLastRect.y === scaledY &&
    gstLastRect.width === scaledWidth && gstLastRect.height === scaledHeight && gstLastRect.scale === scale) {
    return;
  }
  gstLastRect = { x: scaledX, y: scaledY, width: scaledWidth, height: scaledHeight, scale };
  if (gstDebugEnabled) {
    log('debug', 'gst', 'rect', { viewport: gstViewport, bounds, scale, rect: gstLastRect });
    noteGstRectUpdate();
  }
  sendGstCommand('rect', [scaledX.toString(), scaledY.toString(), scaledWidth.toString(), scaledHeight.toString()])
    .catch((error) => log('warn', 'gst', 'rect-failed', error instanceof Error ? error.message : error));
}

async function initGst(): Promise<void> {
  if (!mainWindow) return;
  killGst();
  const helperPath = getGstHelperPath();
  if (!helperPath) {
    log('error', 'gst', 'helper-not-found');
    sendToRenderer('mpv-error', 'GStreamer helper not found');
    return;
  }

  if (gstUseAppsink) {
    startFrameServer();
  }

  const env = {
    ...process.env,
    ...(gstFrameSocketPath ? { SBTLTV_GST_FRAME_SOCKET: gstFrameSocketPath } : {}),
  };
  gstProcess = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'], env });
  gstProcess.stdout?.on('data', (data: Buffer) => {
    gstBuffer += data.toString();
    const lines = gstBuffer.split('\n');
    gstBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length) handleGstLine(trimmed);
    }
  });
  gstProcess.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    log('error', 'gst', 'stderr', text);
    const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    if (lines.length) {
      gstStderrTail = [...gstStderrTail, ...lines].slice(-GST_STDERR_TAIL_MAX);
    }
  });
  gstProcess.on('error', (error: Error) => {
    log('error', 'gst', 'process-error', error.message);
    sendToRenderer('mpv-error', error.message);
  });
  gstProcess.on('exit', (code, signal) => {
    log('warn', 'gst', 'process-exit', { code, signal });
    gstReady = false;
    sendToRenderer('mpv-ready', false);
    const exitInfo = `code ${code ?? 'unknown'}${signal ? ` signal ${signal}` : ''}`;
    const stderrInfo = gstStderrTail.length ? `; stderr: ${gstStderrTail.join(' | ')}` : '';
    sendToRenderer('mpv-error', `GStreamer helper exited (${exitInfo})${stderrInfo}`);
    killGst();
  });

  if (!gstUseAppsink) {
    await ensureWindowReadyForEmbed(mainWindow);
    const xid = await waitForLinuxXid(mainWindow);
    if (xid.xid <= 1) {
      log('error', 'gst', 'invalid-xid', xid);
      sendToRenderer('mpv-error', 'Failed to obtain X11 window handle');
      return;
    }
    await sendGstCommand('window', [xid.xid.toString()]).catch((error) => {
      log('error', 'gst', 'window-handle', error instanceof Error ? error.message : error);
    });
    sendGstRect();
    gstResizeHandler = () => sendGstRect();
    if (mainWindow) {
      mainWindow.on('resize', gstResizeHandler);
    }
    log('info', 'gst', 'initialized', { helperPath, xid: xid.xid });
  } else {
    log('info', 'gst', 'initialized', { helperPath, mode: 'appsink' });
  }
}

// Find mpv binary - checks bundled location first, then common locations
function findMpvBinary(): string | null {
  // For packaged apps, check bundled mpv first
  const resourcesPath = app.isPackaged ? process.resourcesPath : __dirname;

  if (process.platform === 'win32') {
    // Check bundled mpv first (in resources/mpv/)
    const bundledPath = path.join(resourcesPath, 'mpv', 'mpv.exe');
    if (fs.existsSync(bundledPath)) return bundledPath;

    // Fall back to system locations
    const windowsPaths = [
      'C:\\Program Files\\mpv\\mpv.exe',
      'C:\\Program Files (x86)\\mpv\\mpv.exe',
      `${process.env.LOCALAPPDATA}\\Programs\\mpv\\mpv.exe`,
    ];
    for (const p of windowsPaths) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        // Continue checking
      }
    }
    return null; // Not found
  } else if (process.platform === 'darwin') {
    // Check bundled mpv first (in resources/mpv/MacOS/ to preserve dylib paths)
    const bundledPath = path.join(resourcesPath, 'mpv', 'MacOS', 'mpv');
    if (fs.existsSync(bundledPath)) return bundledPath;

    // Fall back to system locations
    if (fs.existsSync('/opt/homebrew/bin/mpv')) return '/opt/homebrew/bin/mpv';
    if (fs.existsSync('/usr/local/bin/mpv')) return '/usr/local/bin/mpv';
    if (fs.existsSync('/usr/bin/mpv')) return '/usr/bin/mpv';
    return null;
  } else {
    // Linux - rely on system mpv
    if (fs.existsSync('/usr/bin/mpv')) return '/usr/bin/mpv';
    if (fs.existsSync('/usr/local/bin/mpv')) return '/usr/local/bin/mpv';
    return null;
  }
}

// Check if mpv is available and show error dialog if not
async function checkMpvAvailable(): Promise<boolean> {
  const mpvPath = findMpvBinary();
  if (mpvPath) return true;

  if (process.platform === 'linux') {
    await dialog.showMessageBox({
      type: 'error',
      title: 'mpv Required',
      message: 'mpv media player is required but not installed.',
      detail: 'Please install mpv using your package manager:\n\n' +
        'Ubuntu/Debian: sudo apt install mpv\n' +
        'Fedora: sudo dnf install mpv\n' +
        'Arch: sudo pacman -S mpv\n\n' +
        'Then restart the application.',
      buttons: ['OK'],
    });
  } else {
    await dialog.showMessageBox({
      type: 'error',
      title: 'mpv Not Found',
      message: 'mpv media player could not be found.',
      detail: 'Install mpv and restart the application.',
      buttons: ['OK'],
    });
  }

  return false;
}

async function initMpv(): Promise<void> {
  if (!mainWindow) return;

  try {
    // Clean up any existing socket (Unix only)
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch {
        // Ignore
      }
    }

    const mpvBinary = findMpvBinary();
    if (!mpvBinary) {
      console.error('[mpv] Binary not found');
      return;
    }
    console.log('[mpv] Using binary:', mpvBinary);

    const hwdec = 'auto-safe';
    const ytdl = process.env.SBTLTV_YTDL || 'no';
    const ytdlPath = process.env.SBTLTV_YTDL_PATH;
    const isLinux = process.platform === 'linux';
    const isMac = process.platform === 'darwin';
    const sessionType = process.env.XDG_SESSION_TYPE;
    const waylandDisplay = process.env.WAYLAND_DISPLAY;
    const isWayland = isLinux && (sessionType === 'wayland' || (waylandDisplay && waylandDisplay.trim().length > 0));
    let mpvArgs = [
      `--input-ipc-server=${SOCKET_PATH}`,
      '--no-osc',
      '--no-osd-bar',
      '--osd-level=0',
      '--script-opts=osc-idlescreen=no,osc-visibility=never',
      '--keep-open=yes',
      '--idle=yes',
      '--input-default-bindings=no',
      '--no-input-cursor',
      '--cursor-autohide=no',
      '--force-window=yes',
      '--no-terminal',
      '--really-quiet',
      `--hwdec=${hwdec}`,
      '--target-colorspace-hint=no',
      '--tone-mapping=mobius',
      '--hdr-compute-peak=no',
    ];

    mpvArgs.push(`--ytdl=${ytdl}`);
    if (ytdlPath) {
      mpvArgs.push(`--ytdl-path=${ytdlPath}`);
    }

    const vo = isLinux && isWayland ? 'dmabuf-wayland' : 'gpu';
    mpvArgs.push(`--vo=${vo}`);
    if (isLinux) {
      if (!isWayland) {
        mpvArgs.push('--gpu-context=x11egl');
      } else if (vo === 'gpu') {
        mpvArgs.push('--gpu-context=wayland');
      }
    }

    const useEmbedding = process.platform === 'win32';
    if (useEmbedding) {
      const nativeHandle = mainWindow.getNativeWindowHandle();
      const windowId = typeof nativeHandle.readBigUInt64LE === 'function'
        ? nativeHandle.readBigUInt64LE(0).toString()
        : nativeHandle.readUInt32LE(0).toString();
      console.log('[mpv] Native window handle:', windowId);
      console.log('[mpv] Using --wid embedding (single window mode)');
      mpvArgs = [...mpvArgs, `--wid=${windowId}`];
    } else {
      console.log('[mpv] Using separate mpv window');
      console.log(`[mpv] vo=${vo} hwdec=${hwdec}`);
      if (isLinux) {
        console.log(`[mpv] session=${isWayland ? 'wayland' : 'x11'}`);
      } else if (isMac) {
        console.log('[mpv] session=macOS');
      }
    }

    console.log('[mpv] Starting with args:', mpvArgs.join(' '));

    mpvProcess = spawn(mpvBinary, mpvArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    mpvProcess.stdout?.on('data', (data: Buffer) => {
      const str = data.toString();
      if (!str.includes('AV:') && !str.includes('A:') && !str.includes('V:')) {
        console.log('[mpv stdout]', str);
      }
    });

    mpvProcess.stderr?.on('data', (data: Buffer) => {
      console.log('[mpv stderr]', data.toString());
    });

    mpvProcess.on('error', (error: Error) => {
      console.error('[mpv] Process error:', error.message);
      sendToRenderer('mpv-error', error.message);
    });

    mpvProcess.on('exit', (code) => {
      console.log('[mpv] Process exited with code:', code);
      mpvProcess = null;
    });

    await waitForMpvSocket();
    await connectToMpvSocket();

    console.log(`[mpv] Initialized successfully (${useEmbedding ? 'embedded' : 'external'} mode)`);
    sendToRenderer('mpv-ready', true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[mpv] Failed to initialize:', message);
    sendToRenderer('mpv-error', message);
  }
}

async function ensureWindowReadyForEmbed(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed()) return;

  if (!window.isVisible()) {
    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      window.once('show', finish);
      window.show();
    });
  }

  await new Promise((resolve) => setTimeout(resolve, 150));
}

function readLinuxXid(window: BrowserWindow): { xid: number; bufferLen: number; hex: string } {
  const nativeHandle = window.getNativeWindowHandle();
  const bufferLen = nativeHandle.length;
  const xid = bufferLen >= 4 ? nativeHandle.readUInt32LE(0) : 0;
  return { xid, bufferLen, hex: nativeHandle.toString('hex') };
}

async function waitForLinuxXid(
  window: BrowserWindow,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<{ xid: number; bufferLen: number; hex: string }> {
  const start = Date.now();
  let result = readLinuxXid(window);
  while ((result.bufferLen < 4 || result.xid <= 1) && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    result = readLinuxXid(window);
  }
  return result;
}

async function connectToMpvSocket(): Promise<void> {
  return new Promise((resolve, reject) => {
    mpvSocket = net.createConnection(SOCKET_PATH);

    let buffer = '';

    mpvSocket.on('connect', () => {
      console.log('[mpv] Socket connected');

      // Observe properties we care about
      sendMpvCommand('observe_property', [1, 'pause']);
      sendMpvCommand('observe_property', [2, 'volume']);
      sendMpvCommand('observe_property', [3, 'mute']);
      sendMpvCommand('observe_property', [4, 'time-pos']);
      sendMpvCommand('observe_property', [5, 'duration']);

      resolve();
    });

    mpvSocket.on('data', (data: Buffer) => {
      buffer += data.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          handleMpvMessage(msg);
        } catch {
          console.error('[mpv] Failed to parse:', line);
        }
      }
    });

    mpvSocket.on('error', (error: Error) => {
      console.error('[mpv] Socket error:', error.message);
      reject(error);
    });

    mpvSocket.on('close', () => {
      console.log('[mpv] Socket closed');
    });
  });
}

async function waitForMpvSocket(timeoutMs = 5000, intervalMs = 50): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return;
  }

  const start = Date.now();
  while (!fs.existsSync(SOCKET_PATH)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for mpv IPC socket');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

interface MpvMessage {
  event?: string;
  name?: string;
  data?: unknown;
  request_id?: number;
  error?: string;
}

function handleMpvMessage(msg: MpvMessage): void {
  // Handle property change events
  if (msg.event === 'property-change') {
    switch (msg.name) {
      case 'pause':
        mpvState.playing = !msg.data;
        break;
      case 'volume':
        mpvState.volume = (msg.data as number) || 100;
        break;
      case 'mute':
        mpvState.muted = (msg.data as boolean) || false;
        break;
      case 'time-pos':
        mpvState.position = (msg.data as number) || 0;
        break;
      case 'duration':
        mpvState.duration = (msg.data as number) || 0;
        break;
    }

    // Throttle updates to renderer
    const now = Date.now();
    if (now - lastStatusUpdate > STATUS_THROTTLE_MS) {
      lastStatusUpdate = now;
      sendToRenderer('mpv-status', mpvState);
    }
  }

  // Handle request responses
  if (msg.request_id !== undefined) {
    const pending = pendingRequests.get(msg.request_id);
    if (pending) {
      pendingRequests.delete(msg.request_id);
      if (msg.error && msg.error !== 'success') {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.data);
      }
    }
  }
}

function sendMpvCommand(command: string, args: unknown[] = []): Promise<unknown> {
  if (!mpvSocket) return Promise.reject(new Error('Not connected'));

  const id = ++requestId;
  const cmd = { command: [command, ...args], request_id: id };

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    mpvSocket!.write(JSON.stringify(cmd) + '\n');

    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Command timeout'));
      }
    }, 5000);
  });
}

function sendToRenderer(channel: string, data: unknown): void {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, data);
  }
}

const FRAME_MAGIC = 0x5342544c;
const FRAME_HEADER_SIZE = 40;
const FRAME_FORMAT_RGBA = 1;

function resetFrameBuffer(): void {
  gstFrameBuffer = Buffer.alloc(0);
}

function scheduleFrameSend(): void {
  if (!gstLatestFrame || gstFrameSendScheduled) return;
  gstFrameSendScheduled = true;
  setImmediate(() => {
    gstFrameSendScheduled = false;
    if (!gstLatestFrame || !mainWindow) return;
    const payload = gstLatestFrame;
    gstLatestFrame = null;
    const buffer = payload.data;
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    sendToRenderer('player-frame', { info: payload.info, data: arrayBuffer });
  });
}

function handleParsedFrame(info: MpvFrameInfo, data: Buffer): void {
  const infoKey = `${info.width}x${info.height}:${info.stride}:${info.format}`;
  if (infoKey !== gstLastVideoInfoKey) {
    gstLastVideoInfoKey = infoKey;
    sendToRenderer('player-video-info', info);
  }
  gstLatestFrame = { info, data };
  scheduleFrameSend();
}

function parseFrameBuffer(): void {
  const magicBytes = Buffer.from([0x4c, 0x54, 0x42, 0x53]);
  while (gstFrameBuffer.length >= FRAME_HEADER_SIZE) {
    const magic = gstFrameBuffer.readUInt32LE(0);
    if (magic !== FRAME_MAGIC) {
      const next = gstFrameBuffer.indexOf(magicBytes, 1);
      if (next === -1) {
        resetFrameBuffer();
        return;
      }
      gstFrameBuffer = gstFrameBuffer.subarray(next);
      continue;
    }

    const version = gstFrameBuffer.readUInt16LE(4);
    const headerSize = gstFrameBuffer.readUInt16LE(6);
    if (version !== 1 || headerSize < FRAME_HEADER_SIZE) {
      gstFrameBuffer = gstFrameBuffer.subarray(4);
      continue;
    }

    const width = gstFrameBuffer.readUInt32LE(8);
    const height = gstFrameBuffer.readUInt32LE(12);
    const stride = gstFrameBuffer.readUInt32LE(16);
    const format = gstFrameBuffer.readUInt32LE(20);
    const pts = Number(gstFrameBuffer.readBigUInt64LE(24));
    const payloadSize = gstFrameBuffer.readUInt32LE(32);
    const frameId = gstFrameBuffer.readUInt32LE(36);

    const totalSize = headerSize + payloadSize;
    if (gstFrameBuffer.length < totalSize) return;

    if (format === FRAME_FORMAT_RGBA) {
      const payload = Buffer.from(gstFrameBuffer.subarray(headerSize, totalSize));
      handleParsedFrame({ width, height, stride, format: 'RGBA', pts, frameId }, payload);
    }

    gstFrameBuffer = gstFrameBuffer.subarray(totalSize);
  }
}

function startFrameServer(): void {
  if (gstFrameServer) return;
  const socketPath = `/tmp/sbtltv-gst-frames-${process.pid}.sock`;
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }
  gstFrameSocketPath = socketPath;
  gstFrameServer = net.createServer((socket) => {
    resetFrameBuffer();
    socket.on('data', (chunk: Buffer) => {
      gstFrameBuffer = Buffer.concat([gstFrameBuffer, chunk]);
      parseFrameBuffer();
    });
    socket.on('error', (error: Error) => {
      log('warn', 'gst', 'frame-socket-error', error.message);
    });
  });
  gstFrameServer.on('error', (error: Error) => {
    log('error', 'gst', 'frame-server-error', error.message);
  });
  gstFrameServer.listen(socketPath);
}

function stopFrameServer(): void {
  if (gstFrameServer) {
    gstFrameServer.close();
    gstFrameServer = null;
  }
  if (gstFrameSocketPath && fs.existsSync(gstFrameSocketPath)) {
    fs.unlinkSync(gstFrameSocketPath);
  }
  gstFrameSocketPath = null;
  gstLastVideoInfoKey = '';
  gstLatestFrame = null;
  gstFrameSendScheduled = false;
  resetFrameBuffer();
}

// IPC Handlers - Window controls
ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window-close', () => mainWindow?.close());

// Window resize for frameless windows
ipcMain.handle('window-get-size', () => mainWindow?.getSize());
ipcMain.handle('window-set-size', (_event, width: number, height: number) => {
  if (!mainWindow) return;
  const newW = Math.max(MIN_WIDTH, Math.round(width));
  const newH = Math.max(MIN_HEIGHT, Math.round(height));
  // setSize doesn't work for shrinking on transparent windows in Electron 40
  // Use setBounds which seems to work in both directions
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds({ x: bounds.x, y: bounds.y, width: newW, height: newH });
  sendGstRect();
});

// IPC Handlers - mpv control
ipcMain.handle('mpv-load', async (_event, url: string) => {
  if (process.platform === 'linux') {
    if (gstDebugEnabled) {
      log('debug', 'gst', 'load', sanitizeUrlForLog(url));
    }
    const resolved = await resolveGstLoadUrl(url);
    if (!resolved.url) {
      return { error: resolved.error ?? 'Failed to resolve stream URL' };
    }
    return sendGstCommand('load', [resolved.url]);
  }
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    const ytdlMode = resolveYtdlMode(url);
    const useYtdl = ytdlMode === 'yes';
    const loadUrl = useYtdl && !url.startsWith('ytdl://') ? `ytdl://${url}` : url;
    try {
      await sendMpvCommand('set_property', ['ytdl', ytdlMode]);
      if (ytdlMode === 'yes' && process.env.SBTLTV_YTDL_PATH) {
        await sendMpvCommand('set_property', ['ytdl-path', process.env.SBTLTV_YTDL_PATH]);
      }
    } catch (error) {
      console.warn('[mpv] Failed to set ytdl mode:', error instanceof Error ? error.message : error);
    }
    await sendMpvCommand('loadfile', [loadUrl]);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-play', async () => {
  if (process.platform === 'linux') {
    return sendGstCommand('play');
  }
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('set_property', ['pause', false]);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-pause', async () => {
  if (process.platform === 'linux') {
    return sendGstCommand('pause');
  }
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('set_property', ['pause', true]);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-toggle-pause', async () => {
  if (process.platform === 'linux') {
    return sendGstCommand('toggle');
  }
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('cycle', ['pause']);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-volume', async (_event, volume: number) => {
  if (process.platform === 'linux') {
    return sendGstCommand('volume', [volume.toString()]);
  }
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('set_property', ['volume', volume]);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-toggle-mute', async () => {
  if (process.platform === 'linux') {
    const nextMute = !mpvState.muted;
    mpvState.muted = nextMute;
    return sendGstCommand('mute', [nextMute ? '1' : '0']);
  }
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('cycle', ['mute']);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-seek', async (_event, seconds: number) => {
  if (process.platform === 'linux') {
    return sendGstCommand('seek', [seconds.toString()]);
  }
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('seek', [seconds, 'absolute']);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-stop', async () => {
  if (process.platform === 'linux') {
    return sendGstCommand('stop');
  }
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('stop', []);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-get-status', async () => {
  if (process.platform === 'linux') {
    try {
      await sendGstCommand('status');
    } catch (error) {
      log('warn', 'gst', 'status-failed', error instanceof Error ? error.message : error);
    }
  }
  return mpvState;
});

ipcMain.handle('mpv-set-viewport', async (_event, rect: GstViewport) => {
  gstViewport = rect;
  if (process.platform === 'linux') {
    if (gstDebugEnabled) {
      log('debug', 'gst', 'viewport', rect);
    }
    sendGstRect();
  }
  return { success: true };
});

// IPC Handlers - Storage
ipcMain.handle('storage-get-sources', async () => {
  try {
    return { success: true, data: storage.getSources() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('storage-get-source', async (_event, id: string) => {
  try {
    return { success: true, data: storage.getSource(id) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('storage-save-source', async (_event, source: Source) => {
  try {
    storage.saveSource(source);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('storage-delete-source', async (_event, id: string) => {
  try {
    storage.deleteSource(id);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('storage-get-settings', async () => {
  try {
    return { success: true, data: storage.getSettings() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('storage-update-settings', async (_event, settings: Parameters<typeof storage.updateSettings>[0]) => {
  try {
    storage.updateSettings(settings);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('storage-is-encryption-available', async () => {
  return { success: true, data: storage.isEncryptionAvailable() };
});

// IPC Handler - Import M3U file via file dialog
ipcMain.handle('import-m3u-file', async () => {
  if (!mainWindow) return { error: 'No window available' };

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import M3U Playlist',
    filters: [
      { name: 'M3U Playlists', extensions: ['m3u', 'm3u8'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  const filePath = result.filePaths[0];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath, path.extname(filePath));
    return { success: true, data: { content, fileName } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to read file' };
  }
});

// URL allowlist for fetch-binary (TMDB exports only) - prevents SSRF attacks
const ALLOWED_BINARY_FETCH_DOMAINS = [
  'files.tmdb.org',       // TMDB daily exports (gzipped)
];

function isAllowedBinaryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_BINARY_FETCH_DOMAINS.some(domain => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

// SSRF protection - block requests to internal/private networks
// These patterns match localhost, private IP ranges, and cloud metadata endpoints
const BLOCKED_URL_PATTERNS = [
  /^https?:\/\/localhost(?::\d+)?(?:\/|$)/i,
  /^https?:\/\/127\.\d+\.\d+\.\d+/,
  /^https?:\/\/\[?::1\]?/,                      // IPv6 localhost
  /^https?:\/\/10\.\d+\.\d+\.\d+/,              // Private Class A
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,      // Private Class B
  /^https?:\/\/192\.168\./,                     // Private Class C
  /^https?:\/\/169\.254\./,                     // Link-local + cloud metadata
  /^file:/i,                                    // File protocol
];

function isBlockedUrl(url: string): boolean {
  return BLOCKED_URL_PATTERNS.some(pattern => pattern.test(url));
}

// Fetch proxy - bypasses CORS by making requests from main process
// Used for IPTV provider API calls (user-configured URLs)
// Blocks internal network access unless allowLanSources is enabled in settings
ipcMain.handle('fetch-proxy', async (_event, url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => {
  try {
    // Check SSRF protection (unless LAN sources are allowed)
    const settings = storage.getSettings();
    if (!settings.allowLanSources && isBlockedUrl(url)) {
      return {
        success: false,
        error: 'Blocked: Local network access is disabled. Enable "Allow LAN sources" in Settings > Security if you trust this source.',
      };
    }

    const response = await electronNet.fetch(url, {
      method: options?.method || 'GET',
      headers: options?.headers,
      body: options?.body,
    });
    const text = await response.text();
    return {
      success: true,
      data: {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Fetch failed',
    };
  }
});

// Fetch binary - for gzipped/binary content, returns base64
// Restricted to TMDB exports only (prevents SSRF with binary data)
ipcMain.handle('fetch-binary', async (_event, url: string) => {
  if (!isAllowedBinaryUrl(url)) {
    return { success: false, error: `Domain not allowed for binary fetch: ${new URL(url).hostname}` };
  }
  try {
    const response = await electronNet.fetch(url);
    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return {
      success: true,
      data: base64,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Fetch failed',
    };
  }
});

// App lifecycle
app.whenReady().then(async () => {
  const useExternalMpv = process.platform !== 'linux';
  const mpvAvailable = useExternalMpv ? await checkMpvAvailable() : true;
  if (!mpvAvailable) {
    app.quit();
    return;
  }
  if (process.platform === 'linux') {
    const DISPLAY = process.env.DISPLAY;
    const XDG_SESSION_TYPE = process.env.XDG_SESSION_TYPE;
    const WAYLAND_DISPLAY = process.env.WAYLAND_DISPLAY;
    console.log('[linux] display env DISPLAY=' + (DISPLAY ?? '') +
      ' XDG_SESSION_TYPE=' + (XDG_SESSION_TYPE ?? '') +
      ' WAYLAND_DISPLAY=' + (WAYLAND_DISPLAY ?? ''));

    const hasX11 = typeof DISPLAY === 'string' && DISPLAY.trim().length > 0;
    const hasWayland = XDG_SESSION_TYPE === 'wayland' ||
      (typeof WAYLAND_DISPLAY === 'string' && WAYLAND_DISPLAY.trim().length > 0);

    if (hasWayland) {
      log('info', 'window', 'xwayland-required', { display: DISPLAY ?? '' });
    }

    if (!hasX11) {
      const title = 'No display detected';
      const message = 'X11 display not detected.';
      await dialog.showMessageBox({
        type: 'error',
        title,
        message,
        detail: 'Log into an X11 session or ensure XWayland is available, then restart the application.',
        buttons: ['OK'],
      });
      app.exit(1);
      return;
    }
  }
  await createWindow();
  if (process.platform === 'linux') {
    await initGst();
  } else if (useExternalMpv) {
    await initMpv();
  }
});

app.on('window-all-closed', () => {
  killMpv();
  killGst();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
