import { app, BrowserWindow, ipcMain, net as electronNet, dialog } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import type { Source } from '@sbtltv/core';
import * as storage from './storage.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimum window dimensions
const MIN_WIDTH = 640;
const MIN_HEIGHT = 620;

let mainWindow: BrowserWindow | null = null;
let mpvProcess: ChildProcess | null = null;
let mpvSocket: net.Socket | null = null;
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

const mpvState: MpvState = {
  playing: false,
  volume: 100,
  muted: false,
  position: 0,
  duration: 0,
};

// Windows uses named pipes, Linux/macOS use Unix sockets
const SOCKET_PATH = process.platform === 'win32'
  ? `\\\\.\\pipe\\mpv-socket-${process.pid}`
  : `/tmp/mpv-socket-${process.pid}`;

// Throttle status updates to renderer (max once per 100ms)
let lastStatusUpdate = 0;
const STATUS_THROTTLE_MS = 100;

async function createWindow(): Promise<void> {
  // On Windows and Linux, use a transparent window so mpv shows through
  const isWindows = process.platform === 'win32';
  const isLinux = process.platform === 'linux';
  const useTransparent = isWindows || isLinux;
  const useFrameless = isWindows || isLinux;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    backgroundColor: useTransparent ? '#00000000' : '#000000',
    transparent: useTransparent, // Transparent on Windows/Linux so mpv shows through
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
      detail: 'The bundled mpv appears to be missing. Please reinstall the application.',
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
      '--hwdec=auto-safe',
      '--vo=gpu',
      '--target-colorspace-hint=no',
      '--tone-mapping=mobius',
      '--hdr-compute-peak=no',
    ];

    if (process.platform === 'linux') {
      mpvArgs.push('--gpu-context=x11');
    }

    let windowId: string;

    if (process.platform === 'linux') {
      await ensureWindowReadyForEmbed(mainWindow);
      const { xid, bufferLen, hex } = await waitForLinuxXid(mainWindow);
      console.log(`[mpv] linux-xid bufferLen=${bufferLen} xid=${xid} hex=${hex}`);
      if (bufferLen < 4 || xid <= 1) {
        await dialog.showMessageBox({
          type: 'error',
          title: 'mpv Embed Failed',
          message: 'Failed to obtain a valid X11 window ID for mpv embedding.',
          detail: `bufferLen=${bufferLen} xid=${xid} hex=${hex}`,
          buttons: ['OK'],
        });
        app.exit(1);
        return;
      }
      windowId = xid.toString();
    } else if (process.platform === 'win32') {
      const nativeHandle = mainWindow.getNativeWindowHandle();
      // Windows HWND - try 64-bit first, fall back to 32-bit
      windowId = typeof nativeHandle.readBigUInt64LE === 'function'
        ? nativeHandle.readBigUInt64LE(0).toString()
        : nativeHandle.readUInt32LE(0).toString();
    } else {
      const nativeHandle = mainWindow.getNativeWindowHandle();
      // macOS
      windowId = typeof nativeHandle.readBigUInt64LE === 'function'
        ? nativeHandle.readBigUInt64LE(0).toString()
        : nativeHandle.readUInt32LE(0).toString();
    }

    console.log('[mpv] Native window handle:', windowId);
    console.log('[mpv] Using --wid embedding (single window mode)');

    mpvArgs = [...mpvArgs, `--wid=${windowId}`];

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

    console.log('[mpv] Initialized successfully (embedded mode)');
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
});

// IPC Handlers - mpv control
ipcMain.handle('mpv-load', async (_event, url: string) => {
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('loadfile', [url]);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-play', async () => {
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('set_property', ['pause', false]);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-pause', async () => {
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('set_property', ['pause', true]);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-toggle-pause', async () => {
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('cycle', ['pause']);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-volume', async (_event, volume: number) => {
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('set_property', ['volume', volume]);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-toggle-mute', async () => {
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('cycle', ['mute']);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-seek', async (_event, seconds: number) => {
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('seek', [seconds, 'absolute']);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-stop', async () => {
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('stop', []);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('mpv-get-status', async () => mpvState);

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

if (process.platform === 'linux') {
  const ozoneHint = process.env.ELECTRON_OZONE_PLATFORM_HINT ?? 'auto';
  app.commandLine.appendSwitch('ozone-platform-hint', ozoneHint);
  console.log(`[electron] Ozone platform hint=${ozoneHint}`);
}

// App lifecycle
app.whenReady().then(async () => {
  const mpvAvailable = process.platform === 'linux' ? true : await checkMpvAvailable();
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

    if (!hasX11 && !hasWayland) {
      const title = 'No display detected';
      const message = 'X11 or Wayland display not detected.';
      await dialog.showMessageBox({
        type: 'error',
        title,
        message,
        detail: 'Log into an X11 or Wayland session, then restart the application.',
        buttons: ['OK'],
      });
      app.exit(1);
      return;
    }
  }
  await createWindow();
  if (process.platform !== 'linux') {
    await initMpv();
  }
});

app.on('window-all-closed', () => {
  killMpv();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
