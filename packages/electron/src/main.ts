import { app, BrowserWindow, ipcMain, net as electronNet, dialog, shell, powerSaveBlocker, powerMonitor, safeStorage, session } from 'electron';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess, execFileSync } from 'child_process';
import * as net from 'net';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import type { Source } from '@sbtltv/core';
import * as storage from './storage.js';
import electronUpdater from 'electron-updater';
import { selectChromiumGpuIdentity } from './gpu-selection.js';
import { startDataHost, type DataHost } from './data/data-host.js';
import { rewindMpvProperties, rewindCapBytes, parseCacheState, clampToRange, type CacheRange } from './rewind.js';
import { PlayerMemoryTracker } from './player-memory.js';
import { once } from 'node:events';
import { isTransientDecodeError } from './mpv-error-filter.js';
import { redactUrls } from './log-redact.js';
import { HostLabels } from './host-labels.js';
import { createLineBuffer } from './line-buffer.js';
import { IP_CHECK_URL, IP_CHECK_MAX_BYTES, parseIpCheck } from './ip-check.js';
import { LinuxPerfProbe } from './linux-perf-probe.js';
import { StatusThrottle } from './status-throttle.js';
import { readDesktopColors, watchDesktopColors } from './desktop-colors.js';
import { STREAM_BASE_OPTIONS, STALL_MAX_RELOADS } from './stream-health.js';
import { StreamSession, parseCompatibilityHandoff, type StreamLoadRequest, type CompatibilityHandoff } from './stream-session.js';
import { CaptionSession } from './caption-session.js';
import { SUBTITLE_BASE_OPTIONS, parseSubtitleTracks, subtitleFontsDir, subtitleStyleOptions, TrackReadSchedule } from './subtitle-mpv.js';
import { preferredCaptionLanguage } from './subtitle-settings.js';
const { autoUpdater } = electronUpdater;

// Provider addresses in logs become labels (see host-labels.ts). The debug log
// keeps them only while the user has turned that on in Settings > Debug; it is
// never saved, so every launch starts with labels.
const hostLabels = new HostLabels();
hostLabels.setSources(storage.getSourceAddresses());
let includeAddressesInLog = false;

/** Text for the error card, a terminal or the system log: labels, always. */
function redactForDisplay(text: string): string {
  return redactUrls(text, hostLabels.labeller());
}

/** Text for the debug log: labels, or the addresses while the user has included them (Settings > Debug). */
function redactForLog(text: string): string {
  return redactUrls(text, hostLabels.labeller(includeAddressesInLog));
}
type UpdateInfo = electronUpdater.UpdateInfo;
// Dynamic import - mpv-texture-bridge depends on Electron's sharedTexture API
// which may not be available on all platforms
type MpvTextureBridgeType = import('./mpv-texture-bridge.js').MpvTextureBridge;
const MPV_COMPATIBILITY_ARG = '--mpv-compatibility-mode';
// Compatibility (floating mpv window) mode is chosen per launch: by the flag a
// pipeline-failure restart passes, or by the Linux player setting. Both are
// read here, before app 'ready', because the bridge import below depends on it.
const compatibilityModeFromFlag = process.platform === 'linux' && process.argv.includes(MPV_COMPATIBILITY_ARG);
const compatibilityModeFromSetting = process.platform === 'linux' && storage.getLinuxPlayerMode() === 'compatibility';
const compatibilityModeRequested = compatibilityModeFromFlag || compatibilityModeFromSetting;
let MpvTextureBridgeClass: (new () => MpvTextureBridgeType) | null = null;
// Why the native path is unavailable this launch, shown in the Linux fallback dialog.
let nativeInitError: string | null = null;
// True once the launch has decided between the native bridge and external mpv.
// The renderer mounts before that decision, so 'mpv-get-mode' reports it.
let playerModeSettled = false;
if (process.platform === 'darwin' || (process.platform === 'linux' && !compatibilityModeRequested)) {
  try {
    const mod = await import('./mpv-texture-bridge.js');
    MpvTextureBridgeClass = mod.MpvTextureBridge;
  } catch (error) {
    nativeInitError = `Failed to load mpv-texture-bridge: ${error instanceof Error ? error.message : error}`;
    console.warn('[mpv] Failed to load mpv-texture-bridge:', error);
  }
}

// macOS and Linux default to the native mpv-texture addon.
// Falls back to external mpv process if the bridge fails to load or initialize.
const USE_NATIVE_MPV = process.platform === 'darwin' || (process.platform === 'linux' && !compatibilityModeRequested);

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimum window dimensions
const MIN_WIDTH = 640;
const MIN_HEIGHT = 620;

let mainWindow: BrowserWindow | null = null;
let dataHost: DataHost | null = null;
let mpvProcess: ChildProcess | null = null;
let mpvSocket: net.Socket | null = null;
let requestId = 0;
const pendingRequests = new Map<number, { resolve: (data: unknown) => void; reject: (err: Error) => void }>();

// Native mpv-texture state
let useNativeMpv = false;
// Linux: which player this launch settled on. Unlike useNativeMpv it never
// flips back during a native reset, so window fullscreen wiring can rely on
// it. True when the compatibility player was requested, or when native init
// failed and external mpv was started instead.
let linuxExternalPlayer = compatibilityModeRequested;
let mpvBridge: MpvTextureBridgeType | null = null;

// Track mpv state
let isShuttingDown = false; // Track if we're intentionally closing
// Windows fullscreen state — tracked manually because setFullScreen's enter/leave-full-screen
// events don't fire on the transparent frameless window (and isFullScreen() reads stale there),
// so we drive the renderer's fullscreen state from this boolean instead.
let windowsFullscreen = false;
interface MpvState {
  playing: boolean;
  volume: number;
  muted: boolean;
  position: number;
  duration: number;
  /** Video dimensions — present in native mode, undefined in external mode */
  width?: number;
  height?: number;
}

const mpvState: MpvState = {
  playing: false,
  volume: 100,
  muted: false,
  position: 0,
  duration: 0,
};

// The stream playing: what is loaded, its generation, the resume seek still to
// do, the user's pause and the stall watchdog (stream-session.ts).
const stream = new StreamSession();
// Load generation whose first decoded frame has already been logged.
let decodeLoggedGeneration = -1;
// The player's raw time-pos/duration (either player); mpvState gets them through the gate.
const playerRaw = { position: 0, duration: 0 };
// The external player's eof-reached (keep-open pauses mpv at the end of a file).
let externalEof = false;
let pipelineFailurePromptOpen = false;
let nativeRecoveryInProgress = false;

// Prevent screen sleep during playback
let sleepBlockerId: number | null = null;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;

function updateSleepBlock(playing: boolean): void {
  if (playing && sleepBlockerId === null) {
    sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    debugLog('Sleep prevention enabled', 'system');
  } else if (!playing && sleepBlockerId !== null) {
    powerSaveBlocker.stop(sleepBlockerId);
    sleepBlockerId = null;
    debugLog('Sleep prevention disabled', 'system');
  }
}

// Windows uses named pipes, Linux/macOS use Unix sockets
const SOCKET_PATH = process.platform === 'win32'
  ? `\\\\.\\pipe\\mpv-socket-${process.pid}`
  : `/tmp/mpv-socket-${process.pid}`;

// Status updates to the renderer: position-only ticks (mpv reports them at
// frame rate) at most once per 100ms, the latest held-back tick always sent;
// pause, mute, volume, duration and size changes at once. One throttle per
// path (native bridge, external mpv socket).
const STATUS_THROTTLE_MS = 100;
interface ThrottledStatus { playing: boolean; muted: boolean; volume: number; duration: number; width?: number; height?: number }
const isDiscreteStatusChange = (previous: ThrottledStatus, next: ThrottledStatus) =>
  previous.playing !== next.playing || previous.muted !== next.muted || previous.volume !== next.volume
  || previous.duration !== next.duration || previous.width !== next.width || previous.height !== next.height;
type NativeMpvStatus = Parameters<Parameters<MpvTextureBridgeType['onStatus']>[0]>[0];
let nativeStatusThrottle: StatusThrottle<NativeMpvStatus> | null = null;
const externalStatusThrottle = new StatusThrottle<typeof mpvState>(
  (status) => sendToRenderer('mpv-status', status),
  isDiscreteStatusChange,
  STATUS_THROTTLE_MS,
);

// Debug logging infrastructure
let debugLogStream: fs.WriteStream | null = null;

// Electron's default uncaughtException handler shows a blocking dialog that
// freezes the main process, and with it every IPC call, until dismissed. An
// unclean shutdown from that state has left IndexedDB unable to open. Log it
// and tell the user without stopping the world.
let lastUncaughtReportAt = 0;
process.on('uncaughtException', (error) => {
  const summary = error instanceof Error ? error.message : String(error);
  const detail = error instanceof Error ? error.stack ?? summary : summary;
  console.error('[main] Uncaught exception:', redactForDisplay(detail));
  debugLog(`Uncaught exception: ${detail}`, 'system');
  const now = Date.now();
  if (now - lastUncaughtReportAt < 30_000) return;
  lastUncaughtReportAt = now;
  void dialog.showMessageBox({
    type: 'error',
    title: 'sbtlTV internal error',
    message: 'An internal error occurred. sbtlTV will keep running.',
    detail: `${summary}\n\nDetails are in the debug log when debug logging is enabled (Settings > System).`,
    buttons: ['OK'],
  }).catch(() => {});
});
let debugLoggingEnabled = false;
// Linux in-window player diagnostics; runs only while debug logging is on.
let perfProbe: LinuxPerfProbe | null = null;

// Diagnostics that cost anything run only while debug logging is on: the
// bridge's 2s stats line everywhere, the process/trace probe on Linux.
function syncPlaybackDiagnostics(): void {
  mpvBridge?.setDiagnosticsEnabled(debugLoggingEnabled);
  const wantProbe = debugLoggingEnabled && process.platform === 'linux' && mpvBridge !== null;
  if (wantProbe && !perfProbe) {
    perfProbe = new LinuxPerfProbe((message) => debugLog(message, 'perf'));
    perfProbe.start();
  } else if (!wantProbe && perfProbe) {
    perfProbe.stop();
    perfProbe = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('debug-logging-changed', debugLoggingEnabled);
}
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
    // A locked or unwritable log file must not crash the app: drop file logging.
    debugLogStream.on('error', (error) => {
      console.warn('[debug] Log file stream error, disabling file logging:', error.message);
      debugLogStream = null;
    });
    debugLog('='.repeat(60));
    debugLog(`Debug logging started - sbtlTV v${app.getVersion()}`);
    // CI writes dist/build-info.json so a log can be tied to an exact commit.
    try {
      const info = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')) as { sha?: string; run?: string; ref?: string };
      debugLog(`Build: ${info.sha ?? '?'} (${info.ref ?? '?'}, run ${info.run ?? '?'})`);
    } catch {
      debugLog('Build: local');
    }
    if (!rotationSucceeded) {
      debugLog('Warning: Log rotation failed, continuing with existing file', 'system');
    }
    debugLog(`Platform: ${process.platform} ${process.arch}`);
    debugLog(`Electron: ${process.versions.electron}`);
    debugLog(`Provider addresses: ${includeAddressesInLog ? 'included (turned on in Settings > Debug)' : 'replaced by labels'}`);
    debugLog(`Node: ${process.versions.node}`);
    debugLog('='.repeat(60));
  } else if (!enabled && debugLogStream) {
    debugLog('Debug logging disabled');
    debugLogStream.end();
    debugLogStream = null;
  }
  syncPlaybackDiagnostics();
}

function debugLog(message: string, category = 'app'): void {
  if (!debugLoggingEnabled || !debugLogStream) return;
  try {
    const timestamp = new Date().toISOString();
    // Users attach this log to reports: no provider credentials (they ride in stream URLs).
    const line = `[${timestamp}] [${category}] ${redactForLog(message)}\n`;
    debugLogStream.write(line);
  } catch {
    // Silently fail - logging should never crash the app
  }
}

function compatibilityHandoffPath(): string {
  return path.join(app.getPath('sessionData'), 'mpv-compatibility-handoff.bin');
}

function saveCompatibilityHandoff(handoff: CompatibilityHandoff): boolean {
  if (!safeStorage.isEncryptionAvailable()) {
    debugLog('Skipping playback handoff because safeStorage is unavailable', 'mpv');
    return false;
  }

  try {
    const handoffPath = compatibilityHandoffPath();
    fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(handoff));
    fs.writeFileSync(handoffPath, encrypted, { mode: 0o600 });
    fs.chmodSync(handoffPath, 0o600);
    return true;
  } catch (error) {
    debugLog(`Could not save encrypted compatibility handoff: ${error instanceof Error ? error.message : error}`, 'mpv');
    return false;
  }
}

function consumeCompatibilityHandoff(): CompatibilityHandoff | null {
  const handoffPath = compatibilityHandoffPath();
  if (!fs.existsSync(handoffPath)) return null;

  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const decrypted = safeStorage.decryptString(fs.readFileSync(handoffPath));
    return parseCompatibilityHandoff(JSON.parse(decrypted));
  } catch (error) {
    debugLog(`Could not consume compatibility handoff: ${error instanceof Error ? error.message : error}`, 'mpv');
    return null;
  } finally {
    try { fs.unlinkSync(handoffPath); } catch { /* Already removed or inaccessible. */ }
  }
}

function discardStaleCompatibilityHandoff(): void {
  try { fs.unlinkSync(compatibilityHandoffPath()); } catch { /* No stale handoff. */ }
}

async function getHighPerformanceWebGlRenderer(): Promise<unknown> {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    return await mainWindow.webContents.executeJavaScript(`(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' });
      if (!gl) return null;
      const debugRenderer = gl.getExtension('WEBGL_debug_renderer_info');
      if (!debugRenderer) return null;
      const result = {
        vendor: gl.getParameter(debugRenderer.UNMASKED_VENDOR_WEBGL),
        renderer: gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL),
      };
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return result;
    })()`);
  } catch (error) {
    debugLog(`Could not read high-performance WebGL renderer: ${error instanceof Error ? error.message : error}`, 'mpv');
    return null;
  }
}

async function getChromiumGpuIdentity(): Promise<{ vendorId?: number; deviceId?: number }> {
  const webGlRenderer = await getHighPerformanceWebGlRenderer();
  let devices: unknown;
  try {
    const info: unknown = await app.getGPUInfo('basic');
    devices = info && typeof info === 'object'
      ? (info as Record<string, unknown>).gpuDevice
      : undefined;
  } catch (error) {
    debugLog(`Could not read Chromium GPU identity: ${error instanceof Error ? error.message : error}`, 'mpv');
  }
  // Selection errors must reach initNativeMpv's compatibility fallback.
  const gpu = selectChromiumGpuIdentity(devices, webGlRenderer);
  debugLog(`GPU selection source=${gpu.source}`, 'mpv');
  return gpu;
}

async function createWindow(bounds?: Electron.Rectangle): Promise<void> {
  // On Windows, we use a transparent frameless window for mpv embedding
  const isWindows = process.platform === 'win32';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    ...bounds,
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
      // No spell checking in the window (see the session settings in app.whenReady).
      spellcheck: false,
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
    if (!nativeRecoveryInProgress) killMpv();
  });

  // Drive the renderer's "fullscreen" state (button icon + Esc-to-exit). macOS uses true OS
  // fullscreen events; Linux uses maximize state. Windows is driven directly from the
  // window-set-fullscreen handler — setFullScreen DOES cover the screen on the transparent
  // frameless window, but enter/leave-full-screen never fire there, so events are unreliable.
  if (process.platform === 'darwin') {
    mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('window-fullscreen-changed', true));
    mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('window-fullscreen-changed', false));
  } else if (process.platform === 'linux') {
    // In-window player: real fullscreen, so the OS events drive the state.
    // Compatibility player: mpv plays in its own window and handles its own
    // fullscreen; for this window, maximize is what "fullscreen" has meant.
    mainWindow.on('enter-full-screen', () => { if (!linuxExternalPlayer) mainWindow?.webContents.send('window-fullscreen-changed', true); });
    mainWindow.on('leave-full-screen', () => { if (!linuxExternalPlayer) mainWindow?.webContents.send('window-fullscreen-changed', false); });
    mainWindow.on('maximize', () => { if (linuxExternalPlayer) mainWindow?.webContents.send('window-fullscreen-changed', true); });
    mainWindow.on('unmaximize', () => { if (linuxExternalPlayer) mainWindow?.webContents.send('window-fullscreen-changed', false); });
  }
}

// The native player being torn down after the window closed; a new one waits for it.
let bridgeTeardown: Promise<void> | null = null;

function killMpv(): void {
  isShuttingDown = true;
  stopCachePoll();
  cacheWatch = null;
  // The player is going away (window closed; on macOS the app stays): so does what it was playing.
  endPlayback({ invalidate: true });

  // Clean up native mpv bridge
  if (mpvBridge) {
    try {
      bridgeTeardown = mpvBridge.destroy().catch(error => {
        debugLog(`Error destroying native bridge: ${error instanceof Error ? error.message : error}`, 'mpv');
      });
    } catch (error) {
      debugLog(`Error destroying native bridge: ${error instanceof Error ? error.message : error}`, 'mpv');
    }
    mpvBridge = null;
    nativeStatusThrottle?.reset();
    syncPlaybackDiagnostics();
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
    // Fallback: check PATH (catches MacPorts, Nix, custom prefix installs)
    try {
      const whichResult = execFileSync('which', ['mpv'], { encoding: 'utf-8' }).trim();
      if (whichResult && fs.existsSync(whichResult)) return whichResult;
    } catch {
      // which failed, mpv not in PATH
    }

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
  if (process.platform === 'linux') linuxExternalPlayer = true;

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
      ...STREAM_BASE_OPTIONS.map(([name, value]) => `--${name}=${value}`),
      ...SUBTITLE_BASE_OPTIONS.map(([name, value]) => `--${name}=${value}`),
      `--sub-fonts-dir=${subtitleFontsPath()}`,
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
      if (isLinux) {
        // Linux separate window: enable default keybindings (f=fullscreen, m=mute, arrows=seek, etc.)
        mpvArgs = mpvArgs.filter(a => a !== '--input-default-bindings=no' && a !== '--no-input-cursor' && a !== '--cursor-autohide=no');
        mpvArgs.push('--input-default-bindings=yes', '--cursor-autohide=1000');
      }
    } else {
      console.log('[mpv] Using --wid embedding (single window mode)');
      mpvArgs = [...mpvArgs, `--wid=${windowId}`];
    }

    const argsStr = mpvArgs.join(' ');
    console.log('[mpv] Starting with args:', argsStr);
    debugLog(`Starting with args: ${argsStr}`, 'mpv');

    const proc = spawn(mpvBinary, mpvArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    mpvProcess = proc;

    // Whole lines only, so a link split across chunks is still redacted as one.
    const stdoutLines = createLineBuffer((line) => {
      debugLog(line, 'mpv-stdout');
      // Only console.log non-status lines
      if (!line.includes('AV:') && !line.includes('A:') && !line.includes('V:')) {
        console.log('[mpv stdout]', redactForDisplay(line));
      }
    });
    const stderrLines = createLineBuffer((line) => {
      debugLog(line, 'mpv-stderr');
      console.log('[mpv stderr]', redactForDisplay(line));
    });
    mpvProcess.stdout?.on('data', (data: Buffer) => stdoutLines.push(data.toString()));
    mpvProcess.stderr?.on('data', (data: Buffer) => stderrLines.push(data.toString()));
    mpvProcess.on('close', () => { stdoutLines.flush(); stderrLines.flush(); });

    mpvProcess.on('error', (error: Error) => {
      debugLog(`Process error: ${error.message}`, 'mpv');
      console.error('[mpv] Process error:', error.message);
      reportMpvError(error.message);
    });

    mpvProcess.on('exit', (code) => {
      debugLog(`Process exited with code: ${code}`, 'mpv');
      console.log('[mpv] Process exited with code:', code);
      // A replaced player (restart) exiting late must not touch its successor.
      if (mpvProcess !== proc) return;
      mpvProcess = null;

      // Clean up socket when process dies
      if (mpvSocket) {
        mpvSocket.destroy();
        mpvSocket = null;
      }

      // Auto-restart if not intentionally shutting down
      if (!isShuttingDown && mainWindow) {
        console.log('[mpv] Unexpected exit, restarting in 1 second...');
        reportMpvError('mpv crashed, restarting...');
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
    playerModeSettled = true;
    sendToRenderer('mpv-ready', true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[mpv] Failed to initialize:', message);
    reportMpvError(message);
  }
}

const NVIDIA_VENDOR_ID = 0x10de;

/**
 * Initialize native mpv-texture bridge for GPU-accelerated playback
 * Returns true if successful, false if should fall back to external mpv
 */
async function initNativeMpv(): Promise<boolean> {
  if (!mainWindow) return false;
  if (!MpvTextureBridgeClass) return false;

  let bridge: MpvTextureBridgeType | null = null;
  try {
    const gpu = process.platform === 'linux' ? await getChromiumGpuIdentity() : {};
    if (gpu.vendorId !== undefined) {
      debugLog(
        `Chromium GPU vendor=0x${gpu.vendorId.toString(16)} device=${gpu.deviceId !== undefined ? `0x${gpu.deviceId.toString(16)}` : 'unknown'}`,
        'mpv'
      );
    }
    bridge = new MpvTextureBridgeClass();
    const isLinux = process.platform === 'linux';
    // NVIDIA's proprietary driver does not make the importer wait for GL work
    // on a shared DMA-BUF (Mesa does), so Chromium could sample a slot mpv was
    // still drawing: brief black frames. Wait for the frame to finish there.
    const finishBeforeExport = process.env.SBTLTV_MPV_GL_FINISH === '1' || (isLinux && gpu.vendorId === NVIDIA_VENDOR_ID);
    if (finishBeforeExport) debugLog('mpv frames finish before export (glFinish)', 'mpv');
    const success = await bridge.initialize(mainWindow, {
      hwdec: 'auto',
      gpuVendorId: gpu.vendorId,
      gpuDeviceId: gpu.deviceId,
      debugLogging: debugLoggingEnabled,
      finishBeforeExport,
      // Linux only: the stats overlay gives testers decode and drop numbers on
      // the video (I key) without a terminal. mpv's software-fallback threshold
      // is left at its default: on Intel iHD the zero-copy surfaces fail to
      // decode at all (green frames), so a higher threshold only prolonged that
      // before the working copy path took over (tested on 0.11.1 pre-release).
      statsOverlay: isLinux,
      // Linux performance mode (Settings > Video Player): cheaper mpv rendering for
      // GPUs that cannot keep up with the in-window pipeline. Read per launch.
      performanceMode: isLinux && storage.getSettings().linuxPerformanceMode === true,
    });

    if (!success) {
      nativeInitError = bridge.initError ?? 'initialize returned false';
      console.warn('[mpv] Native bridge unavailable:', nativeInitError);
      debugLog(`Native bridge unavailable: ${nativeInitError}`, 'mpv');
      await bridge.destroy();
      return false;
    }

    mpvBridge = bridge;
    useNativeMpv = true;
    syncPlaybackDiagnostics();
    setMpvOptions([...STREAM_BASE_OPTIONS, ...SUBTITLE_BASE_OPTIONS, ['sub-fonts-dir', subtitleFontsPath()]], 'native init');
    applySubtitleStyle('native init');

    // Forward status updates to renderer
    nativeStatusThrottle?.reset();
    const throttle = new StatusThrottle<NativeMpvStatus>(
      (status) => { if (!nativeRecoveryInProgress && mpvBridge === bridge) sendToRenderer('mpv-status', status); },
      isDiscreteStatusChange,
      STATUS_THROTTLE_MS,
    );
    nativeStatusThrottle = throttle;
    bridge.onStatus((rawStatus) => {
      // Until mpv has unloaded the previous file, its numbers are not this load's.
      playerRaw.position = rawStatus.position;
      playerRaw.duration = rawStatus.duration;
      const status = { ...rawStatus, ...stream.gate.pass(rawStatus, Date.now()) };
      if (nativeRecoveryInProgress || mpvBridge !== bridge) return;
      // Sync local state for getStatus calls
      updateSleepBlock(status.playing);
      mpvState.playing = status.playing;
      mpvState.volume = status.volume;
      mpvState.muted = status.muted;
      mpvState.position = status.position;
      mpvState.duration = status.duration;
      mpvState.width = status.width;
      mpvState.height = status.height;

      // First frame of each load: record how it is being decoded so a "frame
      // drops on AMD" report can be told apart from a software-decode report.
      // The previous stream's dimensions linger until the new decoder is up, so
      // wait for hwdec-current to exist before logging the new stream's decode.
      // (Linux only: there hwdec-current is an instant cached read; on macOS it
      // would be a synchronous mpv call on every status until the decode line.)
      const decoderUp = process.platform !== 'linux' || bridge?.getProperty('hwdec-current') !== undefined;
      if (status.width > 0 && status.height > 0 && decodeLoggedGeneration !== stream.generation && decoderUp) {
        decodeLoggedGeneration = stream.generation;
        debugLog(`Decoding ${status.width}x${status.height} ${bridge?.decodeSummary() ?? 'hwdec:?'}`, 'mpv');
        perfProbe?.notePlaybackStarted();
      }

      // File loaded — execute pending resume seek (native path)
      const resumeAt = mpvBridge ? stream.takeResume(status.duration) : null;
      if (resumeAt !== null) {
        debugLog(`Resume (native): seeking to ${resumeAt}s (duration: ${status.duration}s)`, 'mpv');
        mpvBridge?.seek(resumeAt);
      }

      // Subtitle tracks for this load: read track-list only on the schedule
      // (after the video is up, retried briefly until a subtitle track exists),
      // never per status. It is a synchronous call into mpv on this thread.
      if (trackReadGeneration !== stream.generation) {
        trackReadGeneration = stream.generation;
        trackReadSchedule.reset();
      }
      const now = Date.now();
      if (trackReadSchedule.shouldRead(now, status.width > 0 && status.height > 0)) {
        const tracks = parseSubtitleTracks(bridge?.getProperty('track-list'));
        trackReadSchedule.record(now, tracks);
        // Read with the tracks: the status duration can still be the previous file's.
        captions.setTracks(tracks, Number(bridge?.getProperty('duration')) || 0);
      }

      // mpv reports time-pos on every frame. Each forwarded status is an IPC
      // message plus work on the renderer thread that also has to receive and
      // draw every video frame, so position-only ticks are capped at 10/s.
      throttle.push(status);
    });

    // Forward errors to renderer
    bridge.onError((error) => {
      if (nativeRecoveryInProgress || mpvBridge !== bridge) return;
      // hwdec probing, mid-GOP decode errors and skipped file metadata are
      // logged at error level but do not stop playback; the debug log keeps
      // them, the error card does not.
      if (isTransientDecodeError(error, Date.now() - lastJumpAt)) {
        debugLog(`mpv (not shown): ${error.trim()}`, 'mpv');
        return;
      }
      if (error.startsWith('Playback error: ')) reportPlaybackFailure(error);
      else reportMpvLogError(error);
    });

    bridge.onPipelineFailure((error) => {
      if (mpvBridge === bridge) void handleNativePipelineFailure(error);
    });

    bridge.onDiagnostics((message, maxSendMs) => {
      debugLog(message, 'mpv-texture');
      perfProbe?.noteTransferWindow(maxSendMs);
    });

    console.log('[mpv] Native mpv-texture bridge initialized');
    debugLog('Native mpv-texture bridge initialized', 'mpv');
    playerModeSettled = true;
    sendToRenderer('mpv-ready', true);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[mpv] Native bridge failed:', message);
    debugLog(`Native bridge failed: ${message}`, 'mpv');
    nativeInitError = message;
    // Clean up partially-initialized bridge to avoid leaking GL contexts/threads
    await bridge?.destroy();
    return false;
  }
}

async function resetNativePlayback(): Promise<void> {
  // Also without a bridge: a failed player restart leaves none, and this is the way back.
  if (nativeRecoveryInProgress || !mainWindow) return;
  nativeRecoveryInProgress = true;
  const oldWindow = mainWindow;
  const oldBridge = mpvBridge;
  const bounds = oldWindow.getNormalBounds();
  const maximized = oldWindow.isMaximized();
  const fullscreen = oldWindow.isFullScreen();
  const { volume, muted } = mpvState;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
    updateSleepBlock(false);
    endPlayback({ invalidate: true });
    useNativeMpv = false;
    const destruction = oldBridge ? oldBridge.destroy() : Promise.resolve();
    oldWindow.destroy();
    await Promise.race([
      destruction,
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error('Native playback cleanup did not finish; restart is required')), 10000);
      }),
    ]);
    mpvBridge = null;
    nativeStatusThrottle?.reset();
    syncPlaybackDiagnostics();
    Object.assign(mpvState, { playing: false, position: 0, duration: 0, width: 0, height: 0 });
    Object.assign(playerRaw, { position: 0, duration: 0 });
    isShuttingDown = false;
    await createWindow(bounds);
    const replacement = mainWindow as BrowserWindow | null;
    if (!replacement || replacement.isDestroyed()) throw new Error('Playback reset was interrupted');
    if (maximized) replacement.maximize();
    if (fullscreen) replacement.setFullScreen(true);
    if (!await initNativeMpv()) throw new Error(nativeInitError ?? 'Native playback could not be restarted');
    const replacementBridge = mpvBridge as MpvTextureBridgeType | null;
    replacementBridge?.pause();
    replacementBridge?.setVolume(volume);
    if (replacementBridge?.getStatus()?.muted !== muted) replacementBridge?.toggleMute();
  } finally {
    if (deadline) clearTimeout(deadline);
    nativeRecoveryInProgress = false;
  }
}

// app.relaunch defaults to process.execPath, which for an AppImage is the
// binary inside a mount that disappears when this process exits. Relaunch the
// AppImage itself instead; elsewhere this is a plain relaunch.
function relaunchApp(args: string[]): void {
  const appImage = process.env.APPIMAGE;
  if (appImage && !fs.existsSync(appImage)) {
    // A stale variable (moved or deleted file) would make the relaunch fail
    // silently after we exit; fall back to the default and say so.
    debugLog(`APPIMAGE points at a missing file (${appImage}); relaunching the default path`, 'app');
    app.relaunch({ args });
    return;
  }
  app.relaunch(appImage ? { execPath: appImage, args } : { args });
}

function restartInCompatibilityMode(handoff: CompatibilityHandoff | null): void {
  if (handoff) saveCompatibilityHandoff(handoff);
  const relaunchArgs = process.argv.slice(1).filter(argument => argument !== MPV_COMPATIBILITY_ARG);
  relaunchApp([...relaunchArgs, MPV_COMPATIBILITY_ARG]);
  // exit, not quit: a graceful quit tears the native bridge down, which joins
  // the render thread, and a wedged render thread is one reason we are here.
  // The data process gets its shutdown message (non-blocking) and the OS
  // reaps it with us; SQLite's WAL keeps the file consistent.
  dataHost?.shutdown();
  dataHost = null;
  app.exit(0);
}

async function handleNativePipelineFailure(error: string): Promise<void> {
  debugLog(`Native pipeline failure: ${error}`, 'mpv');
  if (pipelineFailurePromptOpen || nativeRecoveryInProgress || !mainWindow) return;
  pipelineFailurePromptOpen = true;
  const handoff = stream.handoff(mpvState.position);
  const isLinux = process.platform === 'linux';

  try {
    mpvBridge?.stop();
    // Stopped: the watchdog must not reload into the broken pipeline, whatever the answer.
    endPlayback({ invalidate: true });
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Native video playback failed',
      message: 'Native video playback stopped working.',
      detail: `${error}\n\nResetting native playback recreates the window and returns to the guide with playback stopped.`,
      buttons: isLinux ? ['Restart in Compatibility Mode', 'Reset Native Playback'] : ['Reset Native Playback', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (isLinux && result.response === 0) {
      restartInCompatibilityMode(handoff);
      return;
    }
    if (!isLinux && result.response !== 0) {
      reportMpvError(error);
      return;
    }
    await resetNativePlayback();
  } catch (handlerError) {
    const message = handlerError instanceof Error ? handlerError.message : String(handlerError);
    debugLog(`Pipeline failure handling error: ${message}`, 'mpv');
    const result = await dialog.showMessageBox({
      type: 'error',
      title: 'Native playback reset failed',
      message,
      buttons: isLinux ? ['Restart in Compatibility Mode', 'Quit'] : ['Quit'],
      cancelId: isLinux ? 1 : 0,
    });
    if (isLinux && result.response === 0) restartInCompatibilityMode(handoff);
    else app.quit();
  } finally {
    pipelineFailurePromptOpen = false;
  }
}

async function confirmCompatibilityFallback(reason: string | null): Promise<boolean> {
  if (process.platform !== 'linux' || !mainWindow) return true;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Native video playback unavailable',
    message: 'sbtlTV could not start the native Linux video pipeline.',
    detail: `${reason ? `${reason}\n\n` : ''}Use floating-window compatibility mode for this launch?`,
    buttons: ['Use Compatibility Mode', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return result.response === 0;
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
      sendMpvCommand('observe_property', [6, 'track-list']);
      sendMpvCommand('observe_property', [7, 'eof-reached']);
      applySubtitleStyle('external mpv connected');

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
          console.error('[mpv] Failed to parse:', redactForDisplay(line));
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
  /** end-file: why the file ended ('eof', 'stop', 'error', ...) and, for 'error', mpv's reason */
  reason?: string;
  file_error?: string;
}

function handleMpvMessage(msg: MpvMessage): void {
  // A file mpv could not open or play (the in-window player reports this through its own error callback).
  if (msg.event === 'end-file' && msg.reason === 'error') {
    reportPlaybackFailure(`Playback error: ${msg.file_error ?? 'unknown error'}`);
  }

  // Handle property change events
  if (msg.event === 'property-change') {
    switch (msg.name) {
      case 'pause':
        if (msg.data !== null && msg.data !== undefined) {
          mpvState.playing = !msg.data;
          updateSleepBlock(mpvState.playing);
        }
        break;
      case 'volume':
        mpvState.volume = (msg.data as number) ?? 100;
        break;
      case 'mute':
        mpvState.muted = (msg.data as boolean) ?? false;
        break;
      case 'time-pos':
        playerRaw.position = (msg.data as number) ?? 0;
        Object.assign(mpvState, stream.gate.pass(playerRaw, Date.now()));
        resumeExternalIfOpen();
        break;
      case 'duration':
        playerRaw.duration = (msg.data as number) ?? 0;
        Object.assign(mpvState, stream.gate.pass(playerRaw, Date.now()));
        // The renderer restores a saved subtitle delay once the duration is known.
        if (mpvState.duration > 0 && captions.tracks.length > 0) captions.setTracks(captions.tracks, mpvState.duration);
        resumeExternalIfOpen();
        break;
      case 'eof-reached':
        externalEof = msg.data === true;
        break;
      case 'track-list':
        // Pushed by mpv on every change (file loaded, CC track created); no polling.
        captions.setTracks(parseSubtitleTracks(msg.data), mpvState.duration);
        break;
    }

    // Throttle updates to renderer. A copy: mpvState keeps changing while a
    // held-back update waits.
    externalStatusThrottle.push({ ...mpvState });
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

// File open (its duration got through the gate): the pending resume seek, external player.
// Checked on every gated update: the duration can arrive while the gate still holds it.
function resumeExternalIfOpen(): void {
  const resumeAt = stream.takeResume(mpvState.duration);
  if (resumeAt === null) return;
  debugLog(`Resume: seeking to ${resumeAt}s (duration: ${mpvState.duration}s)`, 'mpv');
  sendMpvCommand('seek', [resumeAt, 'absolute']).catch(() => {
    debugLog('Resume: seek failed', 'mpv');
  });
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

/** A message in the app's error card; its text goes to the debug log too, so reports can be matched. */
function reportMpvError(message: string): void {
  const text = redactForDisplay(message.trim());
  // Redacted before quoting (a URL ends at whitespace, not at a quote), with the log's own rules.
  debugLog(`banner: ${JSON.stringify(redactForLog(message.trim()))}`, 'mpv');
  sendToRenderer('mpv-error', text);
}

/**
 * mpv could not open or play the file. For a load that never played this is
 * the answer (the card offers Try again), so the stall watchdog does not keep
 * reloading a link that does not open; during a stall reload it is part of the
 * reconnecting and is held like any mpv line.
 */
function reportPlaybackFailure(message: string): void {
  if (!stream.holdsMpvErrors(mpvState.playing)) stream.stopWatchingIfNeverPlayed();
  reportMpvLogError(message);
}

/** One of mpv's own error lines: held back while a stall reload is opening the stream. */
function reportMpvLogError(message: string): void {
  if (stream.holdsMpvErrors(mpvState.playing)) {
    stream.lastHeldError = redactForDisplay(message.trim());  // before quoting: the URL ends at whitespace, not at the quote
    debugLog(`banner held during reconnect: ${JSON.stringify(redactForLog(message.trim()))}`, 'mpv');
    return;
  }
  reportMpvError(message);
}

/** Set mpv options on whichever player is running. Failures are logged, never thrown. */
function setMpvOptions(options: Array<[string, string]>, why: string): void {
  if (useNativeMpv && mpvBridge) {
    for (const [name, value] of options) {
      if (!mpvBridge.command('set', name, value)) debugLog(`subtitles: mpv rejected ${name}=${value} (${why})`, 'mpv');
    }
    return;
  }
  if (!mpvSocket) return;
  for (const [name, value] of options) {
    sendMpvCommand('set_property', [name, value]).catch((err) => {
      debugLog(`subtitles: set ${name} failed (${why}): ${err instanceof Error ? err.message : err}`, 'mpv');
    });
  }
}

function subtitleFontsPath(): string {
  return subtitleFontsDir({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, dirname: __dirname });
}

/** Subtitle look from settings (size, style, font follows the app typeface). */
function applySubtitleStyle(why: string): void {
  const settings = storage.getSettings();
  setMpvOptions(subtitleStyleOptions(settings.subtitles!, settings.appearance?.typeface ?? 'fira'), why);
}

// In-window player: when to read track-list for the current load (see TrackReadSchedule).
const trackReadSchedule = new TrackReadSchedule();
let trackReadGeneration = -1;

async function readSubText(): Promise<string> {
  if (useNativeMpv && mpvBridge) return mpvBridge.getProperty('sub-text') ?? '';
  if (!mpvSocket) return '';
  try {
    const value = await sendMpvCommand('get_property', ['sub-text']);
    return typeof value === 'string' ? value : '';
  } catch {
    return '';  // no subtitle line on screen right now
  }
}

// Subtitle tracks, the selected one and the live caption check (caption-session.ts).
const captions = new CaptionSession({
  setOptions: setMpvOptions,
  readSubText,
  sendTracks: (update) => sendToRenderer('subtitle-tracks', update),
  sendCcState: (update) => sendToRenderer('subtitle-cc-state', update),
  log: (message) => debugLog(message, 'mpv'),
  preferredLanguage: () => preferredCaptionLanguage(storage.getSettings().subtitles!.language, app.getLocale()),
  currentGeneration: () => stream.generation,
});

/** Playback stopped or the player is going away: the stream and its captions end together. */
function endPlayback(opts: { invalidate?: boolean } = {}): void {
  stream.end(opts);
  captions.end();
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

ipcMain.handle('window-set-fullscreen', () => {
  if (!mainWindow) return;
  if (process.platform === 'win32') {
    // Windows: transparent frameless window. setFullScreen DOES cover the whole screen
    // (taskbar included), but enter/leave-full-screen never fire and isFullScreen() reads
    // stale here — so track the state ourselves and drive the renderer directly. The embedded
    // --wid mpv child fills the parent's client area, so it follows the window into fullscreen.
    windowsFullscreen = !windowsFullscreen;
    mainWindow.setFullScreen(windowsFullscreen);
    mainWindow.webContents.send('window-fullscreen-changed', windowsFullscreen);
  } else if (process.platform === 'darwin') {
    // macOS: opaque window + native mpv texture — true OS fullscreen + enter/leave events work.
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  } else if (!linuxExternalPlayer) {
    // Linux in-window player: the video is in this window, so fullscreen it like macOS.
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  } else {
    // Linux compatibility player: maximize is the working fullscreen equivalent for the
    // frameless Electron window; mpv's own window handles its fullscreen.
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

// Linux in-window player only: mpv's stats overlay (I shows it for a few
// seconds, Shift+I keeps it up). Elsewhere this is a no-op.
ipcMain.handle('mpv-toggle-stats', async (_event, persistent: boolean) => {
  if (process.platform !== 'linux' || !useNativeMpv || !mpvBridge) {
    return { error: 'Stats overlay is only available with the Linux in-window player' };
  }
  const shown = mpvBridge.command('script-binding', persistent ? 'stats/display-stats-toggle' : 'stats/display-stats');
  if (!shown) debugLog('stats overlay command rejected; libmpv prints the reason on stderr', 'mpv');
  return shown ? { success: true } : { error: 'mpv rejected the stats command' };
});

// Subtitle controls carry the load generation they were decided for; a late
// call for a previous stream must not change the one now playing.
ipcMain.handle('subtitle-set-track', async (_event, generation: unknown, id: unknown, visible: unknown) => {
  if (!stream.isCurrent(generation)) return { error: 'Stale subtitle request' };
  captions.selectTrack(typeof id === 'number' ? id : null, visible !== false);
  return { success: true };
});

ipcMain.handle('subtitle-set-visible', async (_event, generation: unknown, visible: unknown) => {
  if (!stream.isCurrent(generation)) return { error: 'Stale subtitle request' };
  captions.setVisible(visible === true);
  return { success: true };
});

ipcMain.handle('subtitle-set-delay', async (_event, generation: unknown, seconds: unknown) => {
  if (!stream.isCurrent(generation)) return { error: 'Stale subtitle request' };
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return { error: 'Invalid delay' };
  const clamped = Math.min(Math.max(seconds, -60), 60);
  setMpvOptions([['sub-delay', clamped.toFixed(3)]], 'set delay');
  return { success: true };
});

/**
 * The stream now loaded: its generation, whether it rewinds, its forward buffer
 * size (for the paused nudge) and the last reachable range.
 */
let cacheWatch: { generation: number; rewind: boolean; maxForwardBytes: number; range: CacheRange | null } | null = null;
let cachePoll: NodeJS.Timeout | null = null;
/** What mpv's packet pool may hold since the player last started (decides the memory release). */
const playerMemory = new PlayerMemoryTracker();
/** A player restart in progress (memory release); loads wait for it. */
let playerRestart: Promise<void> | null = null;
/** When playback last jumped (seek, rewind nudge, load): a broken audio frame right after is expected. */
let lastJumpAt = 0;
/** Bumped by every stop: a load that was waiting on a restart must not start after it. */
let stopCount = 0;
/** Paused with the forward buffer this full: move the paused point on so mpv keeps reading. */
const PAUSED_NUDGE_FULL = 0.9;
const PAUSED_NUDGE_SECONDS = 30;

async function readCacheState(): Promise<CacheRange | null> {
  try {
    if (useNativeMpv && mpvBridge) return parseCacheState(mpvBridge.getProperty('demuxer-cache-state'));
    if (mpvSocket) return parseCacheState(await sendMpvCommand('get_property', ['demuxer-cache-state']));
  } catch { /* not available yet (load starting) */ }
  return null;
}

async function readMpvProperty(name: string): Promise<unknown> {
  if (useNativeMpv && mpvBridge) return mpvBridge.getProperty(name);
  return sendMpvCommand('get_property', [name]).catch(() => undefined);
}

/** Cache sizes for the next load; set as properties so every mpv version takes them. */
async function applyCacheProperties(properties: Record<string, string>): Promise<void> {
  for (const [name, value] of Object.entries(properties)) {
    try {
      if (useNativeMpv && mpvBridge) {
        if (!mpvBridge.command('set', name, value)) debugLog(`mpv rejected ${name}=${value}`, 'mpv');
      } else if (mpvSocket) {
        await sendMpvCommand('set', [name, value]);
      }
    } catch (error) {
      debugLog(`setting ${name} failed: ${error instanceof Error ? error.message : error}`, 'mpv');
    }
  }
}

/** Watch a new load's cache: once a second with rewind (the bar needs it), else every 5 s (memory only). */
function startCacheWatch(generation: number, live: boolean, rewind: boolean, maxForwardBytes: number): void {
  stopCachePoll();
  cacheWatch = { generation, rewind, maxForwardBytes, range: null };
  playerMemory.startStream(live);
  let reported = false;
  cachePoll = setInterval(() => {
    void (async () => {
      const range = await readCacheState();
      const watched = cacheWatch;
      if (!watched || watched.generation !== generation || !range) return;
      watched.range = range;
      playerMemory.noteCached(range.bufferedBytes);
      if (!watched.rewind) return;
      if (!reported) {
        // What mpv actually applied for this load.
        reported = true;
        debugLog(`rewind: live load forward ${await readMpvProperty('demuxer-max-bytes')}, back ${await readMpvProperty('demuxer-max-back-bytes')}, donate ${await readMpvProperty('demuxer-donate-buffer')}`, 'mpv');
      }
      // Paused longer than the buffer holds: mpv never drops what is still ahead,
      // so it would stop reading the stream. Move the paused point on; the oldest
      // part rolls off and reading continues (play resumes from the oldest kept).
      if (range.forwardBytes > watched.maxForwardBytes * PAUSED_NUDGE_FULL) {
        const paused = await readMpvProperty('pause');
        if (paused === 'yes' || paused === true) {
          debugLog(`rewind: paused past the buffer; moving the paused point ${PAUSED_NUDGE_SECONDS}s on`, 'mpv');
          lastJumpAt = Date.now();
          if (useNativeMpv && mpvBridge) mpvBridge.command('seek', String(PAUSED_NUDGE_SECONDS), 'relative');
          else await sendMpvCommand('seek', [PAUSED_NUDGE_SECONDS, 'relative']).catch(() => {});
        }
      }
      if (cacheWatch !== watched) return;
      sendToRenderer('rewind-state', { generation, rangeStart: range.rangeStart, liveEdge: range.liveEdge, bytesPerSecond: range.bytesPerSecond });
    })().catch((error) => debugLog(`cache watch failed: ${error instanceof Error ? error.message : error}`, 'mpv'));
  }, rewind ? 1000 : 5000);
}

function stopCachePoll(): void {
  if (cachePoll) clearInterval(cachePoll);
  cachePoll = null;
}

/** Rewind no longer applies to what is loaded (the stream failed): the bar goes, Stop comes back. */
function endRewindForLoad(): void {
  if (cacheWatch) cacheWatch.rewind = false;
  sendToRenderer('rewind-state', null);
}

/** The stream ended: stop watching and, when mpv's pool is worth it, restart the player. */
async function endCacheWatch(event: { event: 'stop' } | { event: 'load'; nextLive: boolean }): Promise<void> {
  const hadStream = cacheWatch !== null;
  stopCachePoll();
  cacheWatch = null;
  sendToRenderer('rewind-state', null);
  if (!hadStream) return;
  const release = playerMemory.shouldRelease(event);
  debugLog(`player memory: ${(playerMemory.peakBytes / 1048576).toFixed(0)} MB cached at most since the player started; ${release ? 'restarting the player to release it' : 'kept'}`, 'mpv');
  if (!release) return;
  const why = `${event.event === 'stop' ? 'stop' : event.nextLive ? 'movie to live' : 'live to movie'} after ${(playerMemory.peakBytes / 1048576).toFixed(0)} MB cached`;
  if (useNativeMpv && mpvBridge) {
    if (mpvBridge.hasRetainedTransfers()) {
      // Its teardown would wait for the window to close; keep the player (and the memory) rather than hang.
      debugLog('player memory: not released now (a frame transfer is still held)', 'mpv');
      return;
    }
    await restartNativePlayer(why);
  } else {
    await restartPlayer(why);
  }
}

/**
 * A fresh in-window player in the same window (mpv keeps a finished stream's
 * cache until it is destroyed; see player-memory.ts). Volume and mute carry over.
 * A teardown that does not finish in time falls back to the full playback reset.
 */
function restartNativePlayer(why: string): Promise<void> {
  if (playerRestart) return playerRestart;
  playerRestart = (async () => {
    const old = mpvBridge;
    if (!old) return;
    const { volume, muted } = mpvState;
    const started = Date.now();
    const before = process.memoryUsage().rss;
    useNativeMpv = false;
    mpvBridge = null;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        old.destroy(),
        new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('the old player did not shut down in time')), 5000); }),
      ]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
    nativeStatusThrottle?.reset();
    Object.assign(mpvState, { playing: false, position: 0, duration: 0, width: 0, height: 0 });
    Object.assign(playerRaw, { position: 0, duration: 0 });
    if (!await initNativeMpv()) throw new Error(nativeInitError ?? 'the player could not be started again');
    const bridge = mpvBridge as MpvTextureBridgeType | null;
    bridge?.setVolume(volume);
    if (bridge?.getStatus()?.muted !== muted) bridge?.toggleMute();
    playerMemory.released();
    debugLog(`player restarted to release memory (${why}) in ${Date.now() - started} ms; rss ${(before / 1048576).toFixed(0)} -> ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`, 'mpv');
  })().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    debugLog(`player restart failed (${message}); resetting native playback`, 'mpv');
    await resetNativePlayback().catch((resetError) => {
      void handleNativePipelineFailure(`Restarting the player failed: ${resetError instanceof Error ? resetError.message : resetError}`);
    });
  }).finally(() => { playerRestart = null; });
  return playerRestart;
}

/**
 * Restart the external player in the same window (not an app quit). The old
 * process must be gone first (SIGKILL if it does not exit in time). Volume and
 * mute carry over. Starts the external player directly: this launch already
 * settled on it (Windows, Linux compatibility, or a native fallback).
 */
function restartPlayer(why: string): Promise<void> {
  if (playerRestart) return playerRestart;
  debugLog(`player restart: ${why}`, 'mpv');
  playerRestart = (async () => {
    const { volume, muted } = mpvState;
    const old = mpvProcess;
    const exited = old && old.exitCode === null ? once(old, 'exit') : null;
    killMpv();
    if (exited && old) {
      const gone = await Promise.race([exited.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000))]);
      if (!gone) {
        debugLog('old mpv did not exit in 3 s; killing it', 'mpv');
        old.kill('SIGKILL');
      }
    }
    isShuttingDown = false;
    await initMpv();
    if (mpvSocket) {
      await sendMpvCommand('set_property', ['volume', volume]).catch(() => {});
      await sendMpvCommand('set_property', ['mute', muted]).catch(() => {});
    }
    playerMemory.released();
  })().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    debugLog(`player restart failed: ${message}`, 'mpv');
    reportMpvError('The player could not be restarted. Restart sbtlTV if playback does not start.');
  }).finally(() => { playerRestart = null; });
  return playerRestart;
}

async function loadMedia(request: StreamLoadRequest & { requestId?: number }): Promise<{ success?: boolean; error?: string }> {
  const stopsAtStart = stopCount;
  if (playerRestart) await playerRestart;
  if (nativeRecoveryInProgress || pipelineFailurePromptOpen) return { error: 'Native playback is being reset' };
  // Switching between live TV and movies/series may restart the player first, to give back mpv's pool.
  await endCacheWatch({ event: 'load', nextLive: request.live });
  if (playerRestart) await playerRestart;
  // Stopped while this load waited for the restart: it must not start playing now.
  if (stopCount !== stopsAtStart) return { error: 'Stopped' };
  if (nativeRecoveryInProgress || pipelineFailurePromptOpen) return { error: 'Native playback is being reset' };
  if (useNativeMpv && mpvBridge && !mpvBridge.isInitialized()) {
    void handleNativePipelineFailure('Reset native playback before selecting another channel');
    return { error: 'Native playback must be reset' };
  }
  const url = request.url;
  hostLabels.noteUrl(url);  // before mpv names the host on its own ("Failed to resolve hostname …")
  lastJumpAt = Date.now();
  const { generation, resumeAt } = stream.begin(request, Date.now(), playerRaw);
  debugLog(`mpv-load called (${request.reason})${resumeAt ? ` (resume @ ${resumeAt}s)` : ''}`, 'mpv');
  // The renderer binds subtitles and progress saving to this, whoever started the load;
  // sent before the load's first track update.
  const rewindBytes = request.live ? storage.getRewindLiveBytes() : 0;
  sendToRenderer('media-loaded', { generation, live: request.live, resumeAt, reason: request.reason, requestId: request.requestId ?? null, rewind: rewindBytes > 0 });
  captions.beginLoad();
  const cacheProperties = rewindMpvProperties(rewindBytes, request.live);
  await applyCacheProperties(cacheProperties);
  startCacheWatch(generation, request.live, rewindBytes > 0, Number(cacheProperties['demuxer-max-bytes']));

  // Route to native bridge if available — plain loadfile, no options string
  // (start= option is unreliable across mpv versions; seek-on-duration is used instead)
  if (useNativeMpv && mpvBridge) {
    try {
      await mpvBridge.load(url, '');
      mpvBridge.play(); // ensure playback — pause can persist across loads after a prior EOF
      debugLog('mpv-load SUCCESS (native)', 'mpv');
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      debugLog(`mpv-load FAILED (native): ${errMsg}`, 'mpv');
      return { error: 'Failed to load stream. Enable debug logging in Settings for details.' };
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
    // Ensure playback — mpv keeps pause=yes across loadfile after a prior file hit EOF
    // (e.g. autoplaying the next episode), so loadfile alone would load the new file paused.
    await sendMpvCommand('set_property', ['pause', false]);
    debugLog('mpv-load SUCCESS', 'mpv');
    return { success: true };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    debugLog(`mpv-load FAILED: ${errMsg}`, 'mpv');
    return { error: errMsg };
  }
}

// IPC Handlers - mpv control
ipcMain.handle('mpv-load', async (_event, url: unknown, options: unknown) => {
  if (typeof url !== 'string') return { error: 'Invalid URL' };
  const o = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>;
  return loadMedia({
    url,
    startPosition: typeof o.startPosition === 'number' && Number.isFinite(o.startPosition) ? o.startPosition : undefined,
    live: o.live === true,
    reason: 'play',
    requestId: typeof o.requestId === 'number' ? o.requestId : undefined,
  });
});

// Once a second: a stream that stopped moving without anyone pausing it is
// reloaded (at its position for movies), up to STALL_MAX_RELOADS times, then reported once.
async function checkStreamHealth(): Promise<void> {
  const media = stream.media;
  const watchdog = stream.watchdog;
  if (!watchdog || !media || stream.reloadInFlight || nativeRecoveryInProgress || pipelineFailurePromptOpen) return;
  const action = watchdog.observe({
    now: Date.now(), position: mpvState.position, userPaused: stream.userPaused, duration: mpvState.duration, playing: mpvState.playing,
    // keep-open pauses mpv at the end of a file; the watchdog asks only when mpv paused itself.
    readEof: () => (useNativeMpv && mpvBridge ? mpvBridge.getProperty('eof-reached') === 'yes' : externalEof),
  });
  if (action === 'reload') {
    stream.reloadInFlight = true;
    debugLog(`Stream stalled at ${mpvState.position.toFixed(1)}s; reloading (${watchdog.reloads}/${STALL_MAX_RELOADS})`, 'mpv');
    sendToRenderer('stream-recovery', { state: 'reconnecting', attempt: watchdog.reloads });
    try {
      const request = stream.reloadRequest(mpvState.position);
      const result = request ? await loadMedia(request) : null;
      if (result?.error) debugLog(`Stall reload failed: ${result.error}`, 'mpv');
    } finally {
      stream.reloadInFlight = false;
    }
  } else if (action === 'give-up') {
    debugLog(`Stream still stalled after ${STALL_MAX_RELOADS} reloads; giving up${stream.lastHeldError ? ` (last mpv error: ${JSON.stringify(stream.lastHeldError)})` : ''}`, 'mpv');
    sendToRenderer('stream-recovery', { state: 'failed', live: media.live });
    endRewindForLoad();
  }
}
let lastHealthCheckError: string | null = null;
setInterval(() => {
  checkStreamHealth().catch((err) => {
    // Shown even with debug logging off, once per distinct message: a failing check is a watchdog that is not watching.
    const message = err instanceof Error ? err.message : String(err);
    if (message !== lastHealthCheckError) console.error('[mpv] Stream health check failed:', redactForDisplay(message));
    lastHealthCheckError = message;
    debugLog(`Stream health check failed: ${message}`, 'mpv');
  });
}, 1000).unref();

ipcMain.handle('mpv-play', async () => {
  if (nativeRecoveryInProgress || pipelineFailurePromptOpen) return { error: 'Native playback is being reset' };
  stream.userPaused = false;
  if (useNativeMpv && mpvBridge) {
    try {
      mpvBridge.play();
      return { success: true };
    } catch (error) {
      debugLog(`mpv-play FAILED (native): ${error instanceof Error ? error.message : error}`, 'mpv');
      return { success: true }; // Don't surface transient playback errors to UI
    }
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
  if (nativeRecoveryInProgress || pipelineFailurePromptOpen) return { error: 'Native playback is being reset' };
  stream.userPaused = true;
  if (useNativeMpv && mpvBridge) {
    try {
      mpvBridge.pause();
      return { success: true };
    } catch (error) {
      debugLog(`mpv-pause FAILED (native): ${error instanceof Error ? error.message : error}`, 'mpv');
      return { success: true };
    }
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
  if (nativeRecoveryInProgress || pipelineFailurePromptOpen) return { error: 'Native playback is being reset' };
  stream.userPaused = mpvState.playing;  // playing now: this pauses
  if (useNativeMpv && mpvBridge) {
    try {
      const status = mpvBridge.getStatus();
      if (status?.playing) {
        mpvBridge.pause();
      } else {
        mpvBridge.play();
      }
      return { success: true };
    } catch (error) {
      debugLog(`mpv-toggle-pause FAILED (native): ${error instanceof Error ? error.message : error}`, 'mpv');
      return { success: true };
    }
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
  if (nativeRecoveryInProgress || pipelineFailurePromptOpen) return { error: 'Native playback is being reset' };
  if (useNativeMpv && mpvBridge) {
    try {
      mpvBridge.setVolume(volume);
      return { success: true };
    } catch (error) {
      debugLog(`mpv-volume FAILED (native): ${error instanceof Error ? error.message : error}`, 'mpv');
      return { success: true };
    }
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
  if (nativeRecoveryInProgress || pipelineFailurePromptOpen) return { error: 'Native playback is being reset' };
  if (useNativeMpv && mpvBridge) {
    try {
      mpvBridge.toggleMute();
      return { success: true };
    } catch (error) {
      debugLog(`mpv-toggle-mute FAILED (native): ${error instanceof Error ? error.message : error}`, 'mpv');
      return { success: true };
    }
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
  if (nativeRecoveryInProgress || pipelineFailurePromptOpen) return { error: 'Native playback is being reset' };
  lastJumpAt = Date.now();
  if (cacheWatch?.rewind) {
    // Rewind seeks stay inside the buffer; before its range is known there is nothing to seek in.
    if (!cacheWatch.range) return { success: true };
    seconds = clampToRange(seconds, cacheWatch.range);
  }
  if (useNativeMpv && mpvBridge) {
    try {
      mpvBridge.seek(seconds);
      return { success: true };
    } catch (error) {
      debugLog(`mpv-seek FAILED (native): ${error instanceof Error ? error.message : error}`, 'mpv');
      return { success: true };
    }
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
  if (nativeRecoveryInProgress || pipelineFailurePromptOpen) return { error: 'Native playback is being reset' };
  debugLog('mpv-stop called', 'mpv');
  stopCount++;
  endPlayback({ invalidate: true });
  // After the stop: a restart (memory release) replaces the player, so the stop must have been sent first.
  const releaseRewind = () => { void endCacheWatch({ event: 'stop' }); };
  if (useNativeMpv && mpvBridge) {
    try {
      mpvBridge.stop();
      releaseRewind();
      debugLog('mpv-stop SUCCESS (native)', 'mpv');
      return { success: true };
    } catch (error) {
      debugLog(`mpv-stop FAILED (native): ${error instanceof Error ? error.message : error}`, 'mpv');
      return { success: true };
    }
  }
  if (!mpvSocket) return { error: 'mpv not initialized' };
  try {
    await sendMpvCommand('stop', []);
    releaseRewind();
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
  settled: playerModeSettled,
  // Active hardware decoder while something is playing natively (mpv's
  // hwdec-current: 'vaapi', 'videotoolbox', 'no', ...); null otherwise.
  hwdecCurrent: (useNativeMpv && mpvBridge?.getProperty('hwdec-current')) || null,
  // Linux: the player this process was launched with (setting or flag), so
  // Settings can tell whether a saved change still needs a restart.
  launchPlayerMode: process.platform === 'linux' ? (compatibilityModeRequested ? 'compatibility' : 'native') : null,
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
    dataHost?.pushSources();
    hostLabels.setSources(storage.getSourceAddresses());
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('storage-delete-source', async (_event, id: string) => {
  try {
    storage.deleteSource(id);
    dataHost?.pushSources();
    hostLabels.setSources(storage.getSourceAddresses());
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
  // Only a failure to store is the renderer's error (it tells the user); what
  // the change sets in motion afterwards is logged if it fails.
  let previousLanguage: string | undefined;
  try {
    previousLanguage = storage.getSettings().subtitles?.language;
    storage.updateSettings(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    debugLog(`Settings not stored: ${message}`, 'app');
    return { error: message };
  }
  // Each follow-up on its own, so one that fails does not skip the rest.
  const followUp = (what: string, run: () => void) => {
    try {
      run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[settings] ${what} failed:`, message);
      debugLog(`Settings changed, but ${what} failed: ${message}`, 'app');
    }
  };
  if (settings.subtitles !== undefined || settings.appearance !== undefined) {
    followUp('applying the subtitle style', () => applySubtitleStyle('settings changed'));
  }
  if (settings.subtitles !== undefined) {
    followUp('re-checking captions', () => {
      if (storage.getSettings().subtitles?.language !== previousLanguage) captions.recheckLanguage();
    });
  }
  if (settings.debugLoggingEnabled !== undefined) {
    followUp('switching debug logging', () => initDebugLogging(settings.debugLoggingEnabled!));
  }
  followUp('sending settings to the data process', () => dataHost?.pushSettings());
  return { success: true };
});

ipcMain.handle('storage-is-encryption-available', async () => {
  return { success: true, data: storage.isEncryptionAvailable() };
});

// Debug logging IPC handlers
ipcMain.handle('debug-get-log-path', async () => {
  return { success: true, data: getDebugLogPath() };
});

ipcMain.handle('debug-is-enabled', () => debugLoggingEnabled);
ipcMain.handle('debug-get-include-addresses', () => includeAddressesInLog);
ipcMain.handle('debug-set-include-addresses', (_event, on: unknown) => {
  const next = on === true;
  if (next !== includeAddressesInLog) {
    includeAddressesInLog = next;
    debugLog(next
      ? 'Provider addresses are included in this log from here on (turned on in Settings > Debug)'
      : 'Provider addresses are replaced by labels again');
  }
  return includeAddressesInLog;
});

ipcMain.handle('debug-log-renderer', async (_event, message: string) => {
  debugLog(message, 'renderer');
  return { success: true };
});

// Linux frame pacing: the renderer shows frames a steady ~(queue depth) behind
// arrival. Delay mpv's audio by the same amount so lip sync holds.
ipcMain.on('shared-texture-presentation-delay', (_event, delayMs: unknown) => {
  if (process.platform !== 'linux' || !useNativeMpv || !mpvBridge) return;
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs)) return;
  const seconds = Math.min(Math.max(delayMs, 0), 500) / 1000;
  if (mpvBridge.command('set', 'audio-delay', seconds.toFixed(3))) {
    debugLog(`Audio delayed ${Math.round(seconds * 1000)}ms to match paced video`, 'mpv');
  }
});

// Renderer-side shared-texture failures (import or draw) feed the same
// pipeline escalation as main-side send errors.
ipcMain.on('shared-texture-frame-error', (event, message: unknown) => {
  if (nativeRecoveryInProgress || event.sender !== mainWindow?.webContents) return;
  mpvBridge?.reportRendererFrameError(typeof message === 'string' ? message : 'unknown error');
});

ipcMain.on('shared-texture-frame-ok', (event) => {
  if (nativeRecoveryInProgress || event.sender !== mainWindow?.webContents) return;
  mpvBridge?.reportRendererFrameOk();
});

ipcMain.on('shared-texture-pipeline-failure', (event, message: unknown) => {
  if (nativeRecoveryInProgress || event.sender !== mainWindow?.webContents || typeof message !== 'string') return;
  mpvBridge?.reportPipelineFailure(message);
});

ipcMain.handle('debug-open-log-folder', async () => {
  const { shell } = await import('electron');
  const logPath = getDebugLogPath();
  shell.showItemInFolder(logPath);
  return { success: true };
});

// Settings > Privacy: what IP the outside services see. Only on request, one
// call to Mullvad's public checker; the answer is shown, never stored or logged.
// Settings > Privacy: how saved passwords and API keys are protected on this
// computer (storage.ts encrypts with safeStorage, and falls back to plain
// storage when the system offers no encryption).
ipcMain.handle('privacy-storage-protection', () => {
  const available = safeStorage.isEncryptionAvailable();
  // Linux only: which keyring, or 'basic_text' (Chromium's fixed key, no real keyring).
  const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : null;
  return { platform: process.platform, available, backend };
});

// A failure is logged by its reason only, never with an address.
ipcMain.handle('privacy-check-ip', async () => {
  const failed = (message: string, reason: string) => {
    debugLog(`IP check failed: ${reason}`, 'privacy');
    return { error: message };
  };
  let body: string;
  try {
    const response = await electronNet.fetch(IP_CHECK_URL, {
      cache: 'no-store',
      credentials: 'omit',
      // Only the app's name: no version or system details for this request.
      headers: { 'User-Agent': 'sbtlTV' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return failed(`Mullvad's checker answered with an error (${response.status}). Try again in a moment.`, `HTTP ${response.status}`);
    body = await response.text();
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return error instanceof Error && error.name === 'TimeoutError'
      ? failed("Mullvad's checker did not answer in time. Try again in a moment.", reason)
      : failed("Could not reach Mullvad's checker. Check your connection; a VPN or firewall may be blocking it.", reason);
  }
  if (body.length > IP_CHECK_MAX_BYTES) return failed("Mullvad's checker sent something unexpected.", `answer of ${body.length} bytes`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return failed("Mullvad's checker sent something unexpected. A network login page (hotel, airport) can do this.", 'answer is not JSON');
  }
  const result = parseIpCheck(parsed);
  return result ? { success: true, data: result } : failed("Mullvad's checker sent an answer without an IP address.", 'no IP address in the answer');
});

// Desktop colors for Settings > Appearance (system accent, Caelestia palette)
ipcMain.handle('appearance-get-desktop-colors', () => readDesktopColors());

// App version
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('rewind-cap-bytes', () => rewindCapBytes(os.totalmem()));

// Auto-updater IPC handlers
let updateDownloaded = false;

/**
 * Betas (GitHub pre-releases) are offered when the user turned on Beta
 * updates, and always while running a beta, so a beta install moves on to the
 * next beta and then the stable it leads to. Read before every check so the
 * About toggle applies to the next one.
 */
function applyUpdateChannel(): void {
  autoUpdater.allowPrerelease = storage.getSettings().betaUpdates === true || app.getVersion().includes('-');
}

ipcMain.handle('updater-install', () => {
  if (!updateDownloaded) {
    return { error: 'No update has been downloaded yet' };
  }
  try {
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Install failed';
    debugLog(`Failed to quit and install: ${msg}`, 'updater');
    return { error: msg };
  }
});

ipcMain.handle('updater-check', async () => {
  if (!app.isPackaged) return { error: 'dev' };
  if (process.env.PORTABLE_EXECUTABLE_DIR) return { error: 'portable' };
  if (process.platform === 'linux' && !process.env.APPIMAGE) return { error: 'no-auto-update' };
  try {
    applyUpdateChannel();
    const result = await autoUpdater.checkForUpdates();
    // The updater returns the newest release's info even when it will not
    // install it (an older stable than a running beta), so only pass it on
    // when there is an update to download.
    return { success: true, data: result?.isUpdateAvailable ? result.updateInfo : undefined };
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
// Kept in step with packages/core/src/url-guard.ts, which the data process uses
// for provider requests; main cannot import workspace TypeScript at runtime.
// The check runs on the parsed hostname so userinfo tricks and numeric or
// mapped spellings of a private address are caught; DNS rebinding is not.
function ipv4Octets(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}
function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}
function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const v4 = ipv4Octets(host);
  if (v4) return isPrivateIpv4(v4);
  if (host.startsWith('[') && host.endsWith(']')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::1' || v6 === '::') return true;
    const mapped = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) ?? v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      const dotted = mapped[2] === undefined ? mapped[1] : (() => { const hi = parseInt(mapped[1], 16); const lo = parseInt(mapped[2], 16); return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`; })();
      const o = ipv4Octets(dotted);
      return o ? isPrivateIpv4(o) : true;
    }
    if (/^fe[89ab]/.test(v6) || /^f[cd]/.test(v6)) return true;
  }
  return false;
}
function isBlockedUrl(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return true; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  return isPrivateHost(parsed.hostname);
}

// Fetch proxy - bypasses CORS by making requests from main process
// Used for IPTV provider API calls (user-configured URLs)
// Blocks internal network access unless allowLanSources is enabled in settings
const MAX_PROXY_RESPONSE_BYTES = 512 * 1024 * 1024;

// Electron's request API yields a plain Node stream. net.fetch's Web-stream
// adapter has silently truncated large responses: a 20 MB movie list stopped
// at 16.5 MB on Windows with no error, while the same machine pulled a 312 MB
// EPG through this path intact. Every proxied request goes through here.
async function requestBody(
  url: string,
  options?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ ok: boolean; status: number; statusText: string; body: Buffer }> {
  const response = await new Promise<Electron.IncomingMessage>((resolve, reject) => {
    // Never serve API responses from Chromium's HTTP cache. A provider marked
    // its movie list cacheable for a week and framed it by connection close;
    // a transfer cut off mid-body was cached as complete and replayed on
    // every sync for days. The app keeps its own database; the HTTP cache
    // has nothing to add.
    const request = electronNet.request({ url, method: options?.method || 'GET', cache: 'no-store' });
    for (const [name, value] of Object.entries(options?.headers ?? {})) request.setHeader(name, value);
    request.on('response', resolve);
    request.on('error', reject);
    if (options?.body !== undefined) request.write(options.body);
    request.end();
  });
  // Electron's IncomingMessage is a Node Readable at runtime; its typings don't say so.
  const stream = response as unknown as import('stream').Readable;
  const chunks: Buffer[] = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_PROXY_RESPONSE_BYTES) {
        stream.destroy(new Error(`Response exceeds ${MAX_PROXY_RESPONSE_BYTES / 1024 / 1024}MB limit`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', resolve);
    stream.on('error', reject);
    stream.on('aborted', () => reject(new Error('Response aborted')));
  });
  const status = response.statusCode;
  return { ok: status >= 200 && status < 300, status, statusText: response.statusMessage, body: Buffer.concat(chunks) };
}

ipcMain.handle('fetch-proxy', async (_event, url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => {
  try {
    // Check SSRF protection (unless LAN sources are allowed)
    const settings = storage.getSettings();
    if (!settings.allowLanSources && isBlockedUrl(url)) {
      return {
        success: false,
        error: 'Blocked: Local network access is disabled. Enable "Allow LAN sources" in Settings > System > Security if you trust this source.',
      };
    }

    const response = await requestBody(url, options);
    // Byte count as received from the network stack, before IPC: lets a
    // truncated body be attributed to the network or to the transfer.
    debugLog(`fetch-proxy ${response.status} ${response.body.length}B ${url.split('?')[0]}`, 'net');
    return {
      success: true,
      data: {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text: response.body.toString('utf8'),
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
    return { success: false, error: 'Blocked: Local network access is disabled. Enable "Allow LAN sources" in Settings > System > Security if you trust this source.' };
  }
  try {
    const response = await requestBody(url);
    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
    return {
      success: true,
      data: response.body.toString('base64'),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Fetch failed',
    };
  }
});

// App lifecycle
/**
 * Start the player for the window: the in-window (native) player where it is
 * used, falling back to external mpv; external mpv on Windows and in Linux
 * compatibility mode. False when the app is quitting instead.
 */
async function startPlayer(): Promise<boolean> {
  isShuttingDown = false;
  if (bridgeTeardown) {
    await bridgeTeardown;
    bridgeTeardown = null;
  }
  if (USE_NATIVE_MPV) {
    let nativeSuccess = false;
    if (MpvTextureBridgeClass) {
      console.log('[mpv] Attempting native mpv-texture initialization...');
      nativeSuccess = await initNativeMpv();
    }
    if (nativeSuccess) {
      console.log('[mpv] Using native mpv-texture bridge');
    } else {
      console.log('[mpv] Native bridge unavailable');
      if (!await confirmCompatibilityFallback(nativeInitError)) {
        app.quit();
        return false;
      }
      const mpvAvailable = await checkMpvAvailable();
      if (!mpvAvailable) {
        app.quit();
        return false;
      }
      await initMpv();
    }
  } else {
    // Windows and explicitly requested Linux compatibility launches use external mpv.
    const mpvAvailable = await checkMpvAvailable();
    if (!mpvAvailable) {
      app.quit();
      return false;
    }
    await initMpv();
  }
  return true;
}

app.whenReady().then(async () => {
  // On Windows and Linux, Chromium downloads spell-check dictionaries from Google
  // for the session's languages, even with spell checking off in the window. With
  // no languages there is nothing to download. (macOS uses the system checker.)
  // Neither of these may stop the app from starting: a failure is reported and startup goes on.
  try {
    session.defaultSession.setSpellCheckerLanguages([]);
    session.defaultSession.setSpellCheckerEnabled(false);
  } catch (error) {
    console.error('[startup] Could not turn off the spell checker:', error instanceof Error ? error.message : error);
  }
  try {
    storage.applySettingsUpgrades();
  } catch (error) {
    // Runs again next launch: nothing was marked done.
    console.error('[startup] One-time settings update failed:', error instanceof Error ? error.message : error);
  }

  // Initialize debug logging from saved settings
  const settings = storage.getSettings();
  initDebugLogging(settings.debugLoggingEnabled ?? false);
  if (process.platform === 'linux') {
    const reason = compatibilityModeFromFlag ? 'launch flag' : compatibilityModeFromSetting ? 'setting' : 'default';
    debugLog(`Linux player mode: ${compatibilityModeRequested ? 'compatibility' : 'native'} (${reason})`, 'mpv');
  }
  let compatibilityHandoff: CompatibilityHandoff | null = null;
  if (compatibilityModeRequested) compatibilityHandoff = consumeCompatibilityHandoff();
  else discardStaleCompatibilityHandoff();

  // Before the window: the page asks for its data port as soon as it loads.
  dataHost = startDataHost({
    dbPath: path.join(app.getPath('userData'), 'sbtltv-data.sqlite'),
    tempDir: app.getPath('temp'),
    getSources: () => storage.getSources(),
    getSettings: () => {
      const s = storage.getSettings();
      return { epgRefreshHours: s.epgRefreshHours ?? 6, vodRefreshHours: s.vodRefreshHours ?? 24, allowLanSources: s.allowLanSources ?? false, debugLoggingEnabled: s.debugLoggingEnabled ?? false };
    },
    log: (category, message) => debugLog(message, category),
    onSync: () => {},
  });

  await createWindow();

  // Caelestia rewrites its palette on every wallpaper change.
  watchDesktopColors(() => {
    void readDesktopColors().then((colors) => sendToRenderer('appearance-desktop-colors', colors));
  });

  if (!await startPlayer()) return;

  if (compatibilityHandoff) {
    const { url, position, live } = compatibilityHandoff;
    const result = await loadMedia({ url, startPosition: live ? undefined : position, live, reason: 'restore' });
    if (result.error) reportMpvError('Could not restore playback after compatibility restart.');
  }

  // Auto-updater (packaged builds with native update support:
  //   Windows NSIS, macOS DMG/ZIP, Linux AppImage)
  // Excluded: Windows portable, Linux non-AppImage (no auto-update support)
  const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  const isLinuxNonAppImage = process.platform === 'linux' && !process.env.APPIMAGE;
  if (app.isPackaged && !isPortable && !isLinuxNonAppImage) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    // The mac feed carries minimumSystemVersion as a Darwin kernel version (see
    // release.yml) because electron-updater compares it against os.release().
    // Keep that comparison, but tell the user why updates stopped instead of
    // silently reporting "up to date" on a Mac that can no longer run new builds.
    let unsupportedOsReported = false;
    autoUpdater.isUpdateSupported = (info: UpdateInfo) => {
      const minimum = info.minimumSystemVersion;
      if (!minimum || process.platform !== 'darwin') return true;
      const darwinMajor = Number.parseInt(os.release(), 10);
      const requiredDarwinMajor = Number.parseInt(minimum, 10);
      if (!Number.isFinite(darwinMajor) || !Number.isFinite(requiredDarwinMajor) || darwinMajor >= requiredDarwinMajor) return true;
      // Darwin 20..24 are macOS 11..15; Darwin 25 is macOS 26.
      const requiredMacOS = requiredDarwinMajor >= 25 ? requiredDarwinMajor + 1 : requiredDarwinMajor - 9;
      const message = `sbtlTV ${info.version} requires macOS ${requiredMacOS} or newer; this Mac is on macOS ${process.getSystemVersion()}. Updates are paused.`;
      debugLog(message, 'updater');
      if (!unsupportedOsReported) {
        unsupportedOsReported = true;
        mainWindow?.webContents.send('updater-error', { message });
      }
      return false;
    };

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      debugLog(`Update available: ${info.version}`, 'updater');
      mainWindow?.webContents.send('updater-update-available', info);
    });

    autoUpdater.on('download-progress', (progress) => {
      mainWindow?.webContents.send('updater-download-progress', {
        percent: Math.round(progress.percent),
      });
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
        mainWindow?.webContents.send('updater-error', { message: 'No published releases found' });
      } else {
        debugLog(`Auto-updater error: ${msg.split('\n')[0]}`, 'updater');
        mainWindow?.webContents.send('updater-error', { message: msg.split('\n')[0] });
      }
    });

    if (settings.autoUpdateEnabled ?? true) {
      applyUpdateChannel();
      autoUpdater.checkForUpdates().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        debugLog(`Update check: ${msg.split('\n')[0]}`, 'updater');
      });
    } else {
      debugLog('Auto-update disabled by user setting', 'updater');
    }
  }

  // Sleep/wake handling — pause mpv on suspend to avoid GPU pipeline errors
  let wasPlayingBeforeSuspend = false;

  powerMonitor.on('suspend', () => {
    debugLog('System suspending', 'power');
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
    if (mpvState.playing) {
      wasPlayingBeforeSuspend = true;
      if (useNativeMpv && mpvBridge) {
        try {
          mpvBridge.pause();
        } catch (err) {
          debugLog(`Failed to pause mpv bridge on suspend: ${err instanceof Error ? err.message : err}`, 'power');
        }
      } else if (mpvSocket) {
        sendMpvCommand('set_property', ['pause', true]).catch((err) => {
          debugLog(`Failed to pause mpv on suspend: ${err instanceof Error ? err.message : err}`, 'power');
        });
      }
    } else {
      wasPlayingBeforeSuspend = false;
    }
  });

  powerMonitor.on('resume', () => {
    debugLog('System resumed', 'power');
    if (wasPlayingBeforeSuspend) {
      // Delay resume to allow GPU to reinitialize
      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        debugLog('Resuming playback after wake', 'power');
        if (useNativeMpv && mpvBridge) {
          try {
            mpvBridge.play();
          } catch (err) {
            debugLog(`Failed to resume mpv bridge after wake: ${err instanceof Error ? err.message : err}`, 'power');
          }
        } else if (mpvSocket) {
          sendMpvCommand('set_property', ['pause', false]).catch((err) => {
            debugLog(`Failed to resume mpv after wake: ${err instanceof Error ? err.message : err}`, 'power');
          });
        }
        wasPlayingBeforeSuspend = false;
      }, 1000);
    }
  });
});

ipcMain.on('data-request-port', (event) => dataHost?.giveRendererPort(event.sender));

app.on('before-quit', () => {
  dataHost?.shutdown();
  dataHost = null;
});

app.on('window-all-closed', () => {
  if (nativeRecoveryInProgress) return;
  if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
  updateSleepBlock(false);
  killMpv();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (nativeRecoveryInProgress) return;
  if (BrowserWindow.getAllWindows().length === 0) {
    // macOS keeps the app running after its window closes, and closing it
    // stopped the player (killMpv): the new window needs a player again.
    void createWindow()
      .then(() => startPlayer())
      .catch((error) => debugLog(`Reopening the window failed: ${error instanceof Error ? error.message : error}`, 'app'));
  }
});
