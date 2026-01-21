import { app, BrowserWindow, ipcMain, net as electronNet } from 'electron';
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
  // On Windows, we use a transparent frameless window for mpv embedding
  const isWindows = process.platform === 'win32';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    backgroundColor: isWindows ? '#00000000' : '#000000',
    transparent: isWindows, // Transparent on Windows so mpv shows through
    frame: !isWindows, // Frameless on Windows (required for transparency)
    resizable: true, // Explicit for Electron 40
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the React app
  // In dev, load from Vite server; in prod, load from built files
  if (process.argv.includes('--dev')) {
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../ui/dist/index.html'));
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

// Find mpv binary - checks common locations
function findMpvBinary(): string {
  if (process.platform === 'win32') {
    const windowsPaths = [
      'C:\\Program Files\\mpv\\mpv.exe',
      'C:\\Program Files (x86)\\mpv\\mpv.exe',
      `${process.env.LOCALAPPDATA}\\Programs\\mpv\\mpv.exe`,
      path.join(__dirname, 'mpv', 'mpv.exe'),
      'mpv',
    ];
    for (const p of windowsPaths) {
      if (p === 'mpv') return p;
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        // Continue checking
      }
    }
    return 'mpv';
  } else if (process.platform === 'darwin') {
    // macOS - check homebrew locations
    if (fs.existsSync('/opt/homebrew/bin/mpv')) return '/opt/homebrew/bin/mpv';
    if (fs.existsSync('/usr/local/bin/mpv')) return '/usr/local/bin/mpv';
    return 'mpv';
  } else {
    return '/usr/bin/mpv';
  }
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
    console.log('[mpv] Using binary:', mpvBinary);

    let mpvArgs = [
      `--input-ipc-server=${SOCKET_PATH}`,
      '--no-osc',
      '--no-osd-bar',
      '--osd-level=0',
      '--keep-open=yes',
      '--idle=yes',
      '--input-default-bindings=no',
      '--no-input-cursor',
      '--cursor-autohide=no',
      '--force-window=yes',
      '--no-terminal',
      '--really-quiet',
      '--hwdec=auto',
      '--vo=gpu',
      '--target-colorspace-hint=no',
      '--tone-mapping=mobius',
      '--hdr-compute-peak=no',
    ];

    // Get native window handle for --wid embedding
    const nativeHandle = mainWindow.getNativeWindowHandle();
    let windowId: string;

    if (process.platform === 'linux') {
      windowId = nativeHandle.readUInt32LE(0).toString();
    } else if (process.platform === 'win32') {
      // Windows HWND - try 64-bit first, fall back to 32-bit
      windowId = typeof nativeHandle.readBigUInt64LE === 'function'
        ? nativeHandle.readBigUInt64LE(0).toString()
        : nativeHandle.readUInt32LE(0).toString();
    } else {
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

    // Wait for mpv to create the socket, then connect
    await new Promise((resolve) => setTimeout(resolve, 500));
    await connectToMpvSocket();

    console.log('[mpv] Initialized successfully (embedded mode)');
    sendToRenderer('mpv-ready', true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[mpv] Failed to initialize:', message);
    sendToRenderer('mpv-error', message);
  }
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
    await sendMpvCommand('seek', [seconds, 'relative']);
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

// URL allowlist for fetch-binary (TMDB exports only) - prevents SSRF attacks
// Note: fetch-proxy is unrestricted because it's used for user-configured IPTV providers
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

// Fetch proxy - bypasses CORS by making requests from main process
// Used for IPTV provider API calls (user-configured URLs) - not restricted
ipcMain.handle('fetch-proxy', async (_event, url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => {
  try {
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
  await createWindow();
  await initMpv();
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
