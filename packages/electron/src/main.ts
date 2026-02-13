import { app, BrowserWindow, ipcMain, net as electronNet, dialog, shell } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess, execFileSync } from 'child_process';
import * as net from 'net';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import type { Source } from '@sbtltv/core';
import * as storage from './storage.js';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
type UpdateInfo = electronUpdater.UpdateInfo;
// Dynamic import - mpv-texture-bridge depends on Electron's sharedTexture API
// which may not be available on all platforms
type MpvTextureBridgeType = import('./mpv-texture-bridge.js').MpvTextureBridge;
let MpvTextureBridgeClass: (new () => MpvTextureBridgeType) | null = null;
if (process.platform === 'darwin') {
  try {
    const mod = await import('./mpv-texture-bridge.js');
    MpvTextureBridgeClass = mod.MpvTextureBridge;
  } catch (error) {
    console.warn('[mpv] Failed to load mpv-texture-bridge:', error);
  }
}

// On macOS, default to native mpv-texture addon (IOSurface shared texture).
// Falls back to external mpv process if the addon fails to load.
let mpvTextureAddon: unknown = null;
const USE_NATIVE_MPV = process.platform === 'darwin';
if (USE_NATIVE_MPV) {
  try {
    mpvTextureAddon = await import('@sbtltv/mpv-texture');
    console.log('[mpv-texture] Native addon loaded successfully');
  } catch (error) {
    console.warn('[mpv-texture] Failed to load native addon, falling back to external mpv:', error);
  }
}

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

// Native mpv-texture state
let useNativeMpv = false;
let mpvBridge: MpvTextureBridgeType | null = null;

// Track mpv state
let isShuttingDown = false; // Track if we're intentionally closing
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

// Debug logging infrastructure
let debugLogStream: fs.WriteStream | null = null;
let debugLoggingEnabled = false;
const DEBUG_LOG_MAX_SIZE = 10 * 1024 * 1024; // 10MB max log size

function getDebugLogPath(): string {
  const logDir = app.getPath('logs');
  return path.join(logDir, 'sbtltv-debug.log');
}

function rotateLogIfNeeded(): boolean {
  const logPath = getDebugLogPath();
  try {
    if (fs.existsSync(logPath)) {
      const stats = fs.statSync(logPath);
      if (stats.size > DEBUG_LOG_MAX_SIZE) {
        // Rotate: rename current log to .old, delete previous .old
        const oldLogPath = logPath + '.old';
        if (fs.existsSync(oldLogPath)) {
          fs.unlinkSync(oldLogPath);
        }
        fs.renameSync(logPath, oldLogPath);
      }
    }
    return true;
  } catch {
    // Rotation failed - caller will log this, continue with existing file
    return false;
  }
}

function initDebugLogging(enabled: boolean): void {
  debugLoggingEnabled = enabled;

  if (enabled && !debugLogStream) {
    const logPath = getDebugLogPath();
    // Ensure logs directory exists
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    // Rotate log if it's too large
    const rotationSucceeded = rotateLogIfNeeded();
    // Open log file in append mode
    debugLogStream = fs.createWriteStream(logPath, { flags: 'a' });
    debugLog('='.repeat(60));
    debugLog(`Debug logging started - sbtlTV v${app.getVersion()}`);
    if (!rotationSucceeded) {
      debugLog('Warning: Log rotation failed, continuing with existing file', 'system');
    }
    debugLog(`Platform: ${process.platform} ${process.arch}`);
    debugLog(`Electron: ${process.versions.electron}`);
    debugLog(`Node: ${process.versions.node}`);
    debugLog('='.repeat(60));
  } else if (!enabled && debugLogStream) {
    debugLog('Debug logging disabled');
    debugLogStream.end();
    debugLogStream = null;
  }
}

function debugLog(message: string, category = 'app'): void {
  if (!debugLoggingEnabled || !debugLogStream) return;
  try {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${category}] ${message}\n`;
    debugLogStream.write(line);
  } catch {
    // Silently fail - logging should never crash the app
  }
}

async function createWindow(): Promise<void> {
  // On Windows, we use a transparent frameless window for mpv embedding
  const isWindows = process.platform === 'win32';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    backgroundColor: isWindows ? '#00000000' : '#000000',
    transparent: isWindows, // Only Windows needs transparency (external mpv renders behind)
    frame: false,
    resizable: true, // Explicit for Electron 40
    icon: path.join(__dirname, '../assets/sbtltv-logo-white.png'),
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
    // Packaged app: UI is in resources/ui, unpackaged: relative path
    const uiPath = app.isPackaged
      ? path.join(process.resourcesPath, 'ui', 'index.html')
      : path.join(__dirname, '../../ui/dist/index.html');
    await mainWindow.loadFile(uiPath);
  }

  // Open external links in system browser (restrict to http/https)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol;
      if (protocol === 'https:' || protocol === 'http:') {
        shell.openExternal(url).catch((err) => {
          debugLog(`Failed to open external URL: ${url} - ${err instanceof Error ? err.message : err}`, 'app');
        });
      } else {
        debugLog(`Blocked external URL with protocol ${protocol}: ${url}`, 'app');
      }
    } catch {
      debugLog(`Blocked malformed external URL: ${url}`, 'app');
    }
    return { action: 'deny' };
  });

  // Block top-level navigation away from the app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appOrigin = mainWindow?.webContents.getURL();
    if (appOrigin && !url.startsWith(appOrigin.split('/').slice(0, 3).join('/'))) {
      event.preventDefault();
      debugLog(`Blocked navigation to: ${url}`, 'app');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    killMpv();
  });
}

function killMpv(): void {
  isShuttingDown = true;

  // Clean up native mpv bridge
  if (mpvBridge) {
    mpvBridge.destroy();
    mpvBridge = null;
    useNativeMpv = false;
  }

  // Clean up external mpv process
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
    // Prefer system mpv (properly signed, has GPU access)
    // Bundled mpv has code signing issues that prevent GPU access on macOS
    if (fs.existsSync('/opt/homebrew/bin/mpv')) return '/opt/homebrew/bin/mpv';
    if (fs.existsSync('/usr/local/bin/mpv')) return '/usr/local/bin/mpv';
    if (fs.existsSync('/usr/bin/mpv')) return '/usr/bin/mpv';

    // Fall back to bundled (may have signing issues preventing video display)
    const bundledPath = path.join(resourcesPath, 'mpv', 'MacOS', 'mpv');
    if (fs.existsSync(bundledPath)) return bundledPath;

    return null;
  } else {
    // Linux - rely on system mpv
    if (fs.existsSync('/usr/bin/mpv')) return '/usr/bin/mpv';
    if (fs.existsSync('/usr/local/bin/mpv')) return '/usr/local/bin/mpv';
    // Fallback: check PATH (catches snap, flatpak, custom installs)
    try {
      const whichResult = execFileSync('which', ['mpv'], { encoding: 'utf-8' }).trim();
      if (whichResult && fs.existsSync(whichResult)) return whichResult;
    } catch {
      // which failed, mpv not in PATH
    }
    return null;
  }
}

// Get mpv version as [major, minor] tuple, or null if can't detect
function getMpvVersion(mpvPath: string): [number, number] | null {
  try {
    const output = execFileSync(mpvPath, ['--version'], { encoding: 'utf-8' });
    // Parse "mpv 0.34.1" or "mpv 0.35.0" etc.
    const match = output.match(/mpv\s+(\d+)\.(\d+)/);
    if (match) {
      return [parseInt(match[1], 10), parseInt(match[2], 10)];
    }
  } catch {
    // Failed to get version
  }
  return null;
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
  } else if (process.platform === 'darwin') {
    await dialog.showMessageBox({
      type: 'error',
      title: 'mpv Required',
      message: 'mpv media player is required but not installed.',
      detail: 'Please install mpv using Homebrew:\n\n' +
        'brew install mpv\n\n' +
        'If you don\'t have Homebrew, install it first from https://brew.sh\n\n' +
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

  // Reset shutdown flag when starting
  isShuttingDown = false;

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
    debugLog(`Using binary: ${mpvBinary}`, 'mpv');

    // Check mpv version for logging
    const mpvVersion = getMpvVersion(mpvBinary);
    const versionStr = mpvVersion ? `${mpvVersion[0]}.${mpvVersion[1]}` : 'unknown';
    console.log('[mpv] Version:', versionStr);
    debugLog(`Version: ${versionStr}`, 'mpv');

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
      '--hwdec=auto',
      '--vo=gpu',
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

    // Linux and macOS use separate window mode (--wid embedding is unreliable)
    const isLinux = process.platform === 'linux';
    const isMac = process.platform === 'darwin';
    const useSeparateWindow = isLinux || isMac;

    if (useSeparateWindow) {
      const reason = isMac ? 'macOS' : 'Linux';
      console.log(`[mpv] ${reason} detected, using separate window mode`);
    } else {
      console.log('[mpv] Using --wid embedding (single window mode)');
      mpvArgs = [...mpvArgs, `--wid=${windowId}`];
    }

    const argsStr = mpvArgs.join(' ');
    console.log('[mpv] Starting with args:', argsStr);
    debugLog(`Starting with args: ${argsStr}`, 'mpv');

    mpvProcess = spawn(mpvBinary, mpvArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    mpvProcess.stdout?.on('data', (data: Buffer) => {
      const str = data.toString().trim();
      // Always log to debug file if enabled
      if (str) debugLog(str, 'mpv-stdout');
      // Only console.log non-status lines
      if (!str.includes('AV:') && !str.includes('A:') && !str.includes('V:')) {
        console.log('[mpv stdout]', str);
      }
    });

    mpvProcess.stderr?.on('data', (data: Buffer) => {
      const str = data.toString().trim();
      if (str) debugLog(str, 'mpv-stderr');
      console.log('[mpv stderr]', str);
    });

    mpvProcess.on('error', (error: Error) => {
      debugLog(`Process error: ${error.message}`, 'mpv');
      console.error('[mpv] Process error:', error.message);
      sendToRenderer('mpv-error', error.message);
    });

    mpvProcess.on('exit', (code) => {
      debugLog(`Process exited with code: ${code}`, 'mpv');
      console.log('[mpv] Process exited with code:', code);
      mpvProcess = null;

      // Clean up socket when process dies
      if (mpvSocket) {
        mpvSocket.destroy();
        mpvSocket = null;
      }

      // Auto-restart if not intentionally shutting down
      if (!isShuttingDown && mainWindow) {
        console.log('[mpv] Unexpected exit, restarting in 1 second...');
        sendToRenderer('mpv-error', 'mpv crashed, restarting...');
        setTimeout(() => {
          if (!isShuttingDown && mainWindow) {
            initMpv();
          }
        }, 1000);
      }
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

/**
 * Initialize native mpv-texture bridge for GPU-accelerated playback
 * Returns true if successful, false if should fall back to external mpv
 */
async function initNativeMpv(): Promise<boolean> {
  if (!mainWindow) return false;

  try {
    if (!MpvTextureBridgeClass) return false;
    const bridge = new MpvTextureBridgeClass();
    const success = await bridge.initialize(mainWindow, {
      hwdec: 'auto',
    });

    if (success) {
      mpvBridge = bridge;
      useNativeMpv = true;

      // Forward status updates to renderer
      bridge.onStatus((status) => {
        // Sync local state for getStatus calls
        mpvState.playing = status.playing;
        mpvState.volume = status.volume;
        mpvState.muted = status.muted;
        mpvState.position = status.position;
        mpvState.duration = status.duration;
        sendToRenderer('mpv-status', status);
      });

      // Forward errors to renderer
      bridge.onError((error) => {
        sendToRenderer('mpv-error', error);
      });

      console.log('[mpv] Native mpv-texture bridge initialized');
      debugLog('Native mpv-texture bridge initialized', 'mpv');
      sendToRenderer('mpv-ready', true);
      return true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[mpv] Native bridge failed:', message);
    debugLog(`Native bridge failed: ${message}`, 'mpv');
  }
  return false;
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
      mpvSocket = null;
      reject(error);
    });

    mpvSocket.on('close', () => {
      console.log('[mpv] Socket closed');
      mpvSocket = null;
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
  debugLog(`mpv-load called with URL: ${url}`, 'mpv');

  // Route to native bridge if available
  if (useNativeMpv && mpvBridge) {
    try {
      await mpvBridge.load(url);
      debugLog('mpv-load SUCCESS (native)', 'mpv');
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      debugLog(`mpv-load FAILED (native): ${errMsg}`, 'mpv');
      return { error: errMsg };
    }
  }

  // External mpv via socket
  if (!mpvSocket) {
    debugLog('mpv-load FAILED: mpv not initialized (no socket)', 'mpv');
    return { error: 'mpv not initialized' };
  }
  try {
    debugLog('Sending loadfile command to mpv...', 'mpv');
    await sendMpvCommand('loadfile', [url]);
    debugLog('mpv-load SUCCESS', 'mpv');
    return { success: true };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    debugLog(`mpv-load FAILED: ${errMsg}`, 'mpv');
    return { error: errMsg };
  }
});

ipcMain.handle('mpv-play', async () => {
  if (useNativeMpv && mpvBridge) {
    mpvBridge.play();
    return { success: true };
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
  if (useNativeMpv && mpvBridge) {
    mpvBridge.pause();
    return { success: true };
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
  if (useNativeMpv && mpvBridge) {
    const status = mpvBridge.getStatus();
    if (status?.playing) {
      mpvBridge.pause();
    } else {
      mpvBridge.play();
    }
    return { success: true };
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
  if (useNativeMpv && mpvBridge) {
    mpvBridge.setVolume(volume);
    return { success: true };
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
  if (useNativeMpv && mpvBridge) {
    mpvBridge.toggleMute();
    return { success: true };
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
  if (useNativeMpv && mpvBridge) {
    mpvBridge.seek(seconds);
    return { success: true };
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
  debugLog('mpv-stop called', 'mpv');
  if (useNativeMpv && mpvBridge) {
    mpvBridge.stop();
    debugLog('mpv-stop SUCCESS (native)', 'mpv');
    return { success: true };
  }
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('stop', []);
    debugLog('mpv-stop SUCCESS', 'mpv');
    return { success: true };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    debugLog(`mpv-stop FAILED: ${errMsg}`, 'mpv');
    return { error: errMsg };
  }
});

ipcMain.handle('mpv-get-status', async () => {
  if (useNativeMpv && mpvBridge) {
    return mpvBridge.getStatus() ?? mpvState;
  }
  return mpvState;
});

// Get mpv mode (native vs external) for renderer adaptation
ipcMain.handle('mpv-get-mode', async () => ({
  mode: useNativeMpv ? 'native' : 'external',
  sharedTextureAvailable: useNativeMpv,
}));

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
    // Update debug logging if that setting changed
    if (settings.debugLoggingEnabled !== undefined) {
      initDebugLogging(settings.debugLoggingEnabled);
    }
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('storage-is-encryption-available', async () => {
  return { success: true, data: storage.isEncryptionAvailable() };
});

// Debug logging IPC handlers
ipcMain.handle('debug-get-log-path', async () => {
  return { success: true, data: getDebugLogPath() };
});

ipcMain.handle('debug-log-renderer', async (_event, message: string) => {
  debugLog(message, 'renderer');
  return { success: true };
});

ipcMain.handle('debug-open-log-folder', async () => {
  const { shell } = await import('electron');
  const logPath = getDebugLogPath();
  shell.showItemInFolder(logPath);
  return { success: true };
});

// App version
ipcMain.handle('get-app-version', () => app.getVersion());

// Auto-updater IPC handlers
let updateDownloaded = false;

ipcMain.handle('updater-install', () => {
  if (!updateDownloaded) {
    return { error: 'No update has been downloaded yet' };
  }
  try {
    autoUpdater.quitAndInstall();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Install failed';
    debugLog(`Failed to quit and install: ${msg}`, 'updater');
    return { error: msg };
  }
});

ipcMain.handle('updater-check', async () => {
  if (!app.isPackaged) return { error: 'dev' };
  if (process.env.PORTABLE_EXECUTABLE_DIR) return { error: 'portable' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, data: result?.updateInfo };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Check failed';
    // Clean up common 404 error (no releases published yet)
    if (msg.includes('404') || msg.includes('latest.yml')) {
      return { error: 'No published releases found' };
    }
    return { error: msg.split('\n')[0] };
  }
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

// Check if URL is allowed for binary fetch
// Uses same SSRF protection as fetch-proxy (respects allowLanSources setting)
function isAllowedBinaryUrl(url: string, allowLan: boolean): boolean {
  // Check SSRF protection (unless LAN sources are allowed)
  if (!allowLan && isBlockedUrl(url)) {
    return false;
  }
  // Allow any HTTP/HTTPS URL
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
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

// Fetch binary - for gzipped/binary content (EPG files, TMDB exports), returns base64
// Uses same SSRF protection as fetch-proxy (respects allowLanSources setting)
ipcMain.handle('fetch-binary', async (_event, url: string) => {
  const settings = storage.getSettings();
  if (!isAllowedBinaryUrl(url, settings.allowLanSources ?? false)) {
    return { success: false, error: 'Blocked: Local network access is disabled. Enable "Allow LAN sources" in Settings > Security if you trust this source.' };
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
  // Initialize debug logging from saved settings
  const settings = storage.getSettings();
  initDebugLogging(settings.debugLoggingEnabled ?? false);

  await createWindow();

  // Try native mpv-texture if requested and addon loaded
  if (USE_NATIVE_MPV && mpvTextureAddon) {
    console.log('[mpv] Attempting native mpv-texture initialization...');
    const nativeSuccess = await initNativeMpv();
    if (nativeSuccess) {
      console.log('[mpv] Using native mpv-texture bridge');
    } else {
      console.log('[mpv] Native bridge failed, falling back to external mpv');
      const mpvAvailable = await checkMpvAvailable();
      if (!mpvAvailable) {
        app.quit();
        return;
      }
      await initMpv();
    }
  } else {
    // Non-macOS or addon not loaded: use external mpv
    const mpvAvailable = await checkMpvAvailable();
    if (!mpvAvailable) {
      app.quit();
      return;
    }
    await initMpv();
  }

  // Auto-updater (packaged NSIS builds only, not portable)
  const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged && !isPortable) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      debugLog(`Update available: ${info.version}`, 'updater');
      mainWindow?.webContents.send('updater-update-available', info);
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      updateDownloaded = true;
      debugLog(`Update downloaded: ${info.version}`, 'updater');
      mainWindow?.webContents.send('updater-update-downloaded', info);
    });

    autoUpdater.on('error', (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('404') || msg.includes('latest.yml')) {
        debugLog('No published releases found for auto-update', 'updater');
      } else {
        debugLog(`Auto-updater error: ${msg.split('\n')[0]}`, 'updater');
        mainWindow?.webContents.send('updater-error', { message: msg.split('\n')[0] });
      }
    });

    if (settings.autoUpdateEnabled ?? true) {
      autoUpdater.checkForUpdates().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        debugLog(`Update check: ${msg.split('\n')[0]}`, 'updater');
      });
    } else {
      debugLog('Auto-update disabled by user setting', 'updater');
    }
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
