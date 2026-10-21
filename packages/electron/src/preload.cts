import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron/renderer';
import type { Source } from '@sbtltv/core';
import type { AppSettings } from './storage.js';

// Types for the exposed APIs
export interface MpvStatus {
  playing: boolean;
  volume: number;
  muted: boolean;
  position: number;
  duration: number;
  /** Video dimensions — available in native mode, absent in external mode */
  width?: number;
  height?: number;
}

export interface MpvResult {
  success?: boolean;
  error?: string;
}

export interface MpvLoadOptions {
  /** Seconds to resume at once the file is open */
  startPosition?: number;
  /** A live channel (the stall watchdog reloads it from the live edge, not a position) */
  live?: boolean;
  /** Echoed in media-loaded so the renderer can match the load to its own request */
  requestId?: number;
}

export interface MpvModeInfo {
  mode: 'native' | 'external';
  sharedTextureAvailable: boolean;
  /** False until the launch has decided between native and external; `mode` is a placeholder until then */
  settled?: boolean;
  /** mpv's hwdec-current while playing natively ('vaapi', 'videotoolbox', 'no', ...), else null */
  hwdecCurrent?: string | null;
  /** Linux: player this process launched with ('native' | 'compatibility'); null elsewhere */
  launchPlayerMode?: 'native' | 'compatibility' | null;
}

type StreamRecoveryUpdate =
  | { state: 'reconnecting'; attempt: number }
  | { state: 'failed'; live: boolean };

/**
 * Main starts a load: every one is announced, whoever started it (play: the
 * renderer's request, reload: the stall watchdog, restore: the compatibility
 * restart). Subtitles and progress saving follow the announced generation.
 */
interface RewindStateUpdate {
  generation: number;
  /** Oldest reachable stream time (s) */
  rangeStart: number;
  /** Live edge, stream time (s) */
  liveEdge: number;
  /** Measured input rate, bytes per second */
  bytesPerSecond: number;
}

interface MediaLoadedUpdate {
  generation: number;
  live: boolean;
  /** Seconds the load resumes at, 0 from the start */
  resumeAt: number;
  reason: 'play' | 'reload' | 'restore';
  /** The renderer's requestId for a play, else null */
  requestId: number | null;
  /** Rewind live TV is on for this load (its first rewind-state comes about a second later) */
  rewind: boolean;
}

export interface MpvApi {
  load: (url: string, options?: MpvLoadOptions) => Promise<MpvResult>;
  play: () => Promise<MpvResult>;
  pause: () => Promise<MpvResult>;
  togglePause: () => Promise<MpvResult>;
  stop: () => Promise<MpvResult>;
  setVolume: (volume: number) => Promise<MpvResult>;
  toggleMute: () => Promise<MpvResult>;
  seek: (seconds: number) => Promise<MpvResult>;
  getStatus: () => Promise<MpvStatus>;
  getMode: () => Promise<MpvModeInfo>;
  /** Linux in-window player: show mpv's stats overlay (persistent keeps it on screen) */
  toggleStats: (persistent: boolean) => Promise<MpvResult>;
  onReady: (callback: (ready: boolean) => void) => void;
  onStatus: (callback: (status: MpvStatus) => void) => void;
  onError: (callback: (error: string) => void) => void;
  /** Stall recovery: reconnecting (toast), failed (give up) */
  onStreamRecovery: (callback: (update: StreamRecoveryUpdate) => void) => () => void;
  onMediaLoaded: (callback: (update: MediaLoadedUpdate) => void) => () => void;
  /** Live with rewind: the reachable range once a second; null when rewind is not active */
  onRewindState: (callback: (update: RewindStateUpdate | null) => void) => () => void;
  removeAllListeners: () => void;
}

export interface ElectronWindowApi {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  getSize: () => Promise<[number, number]>;
  setSize: (width: number, height: number) => Promise<void>;
  setFullscreen: () => Promise<void>;
  onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => void;
  removeFullscreenListener: () => void;
}

export interface StorageResult<T = void> {
  success?: boolean;
  error?: string;
  data?: T;
}

export interface M3UImportResult {
  content: string;
  fileName: string;
}

export interface StorageApi {
  getSources: () => Promise<StorageResult<Source[]>>;
  getSource: (id: string) => Promise<StorageResult<Source | undefined>>;
  saveSource: (source: Source) => Promise<StorageResult>;
  deleteSource: (id: string) => Promise<StorageResult>;
  getSettings: () => Promise<StorageResult<AppSettings>>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<StorageResult>;
  isEncryptionAvailable: () => Promise<StorageResult<boolean>>;
  importM3UFile: () => Promise<StorageResult<M3UImportResult> & { canceled?: boolean }>;
}

// Fetch proxy response
export interface FetchProxyResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
}

export interface FetchProxyApi {
  fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<StorageResult<FetchProxyResponse>>;
  fetchBinary: (url: string) => Promise<StorageResult<string>>; // Returns base64-encoded data
}

export interface DebugApi {
  getLogPath: () => Promise<StorageResult<string>>;
  logFromRenderer: (message: string) => Promise<StorageResult>;
  /** Settings > Debug > Bug report: the report.json that would be saved */
  reportPreview: (syncStatus: unknown) => Promise<{ success?: boolean; data?: string; error?: string }>;
  /** Save the bug report zip (save dialog); shows it in its folder */
  saveReport: (syncStatus: unknown) => Promise<{ success?: boolean; canceled?: boolean; data?: { filePath: string }; error?: string }>;
  openLogFolder: () => Promise<StorageResult>;
  isEnabled: () => Promise<boolean>;
  onEnabledChanged: (callback: (enabled: boolean) => void) => () => void;
  getIncludeAddresses: () => Promise<boolean>;
  setIncludeAddresses: (on: boolean) => Promise<boolean>;
  getSourceLegend: () => Promise<{ n: number; name: string }[]>;
}

export interface PlatformApi {
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
  isDev: boolean;
  isPortable: boolean;
  isLinuxNonAppImage: boolean;
  supportsAutoUpdate: boolean;
  getVersion: () => Promise<string>;
  /** The largest Rewind live TV size this computer allows, in bytes (0 = not enough memory) */
  rewindCapBytes: () => Promise<number>;
}

// Expose window control API
contextBridge.exposeInMainWorld('electronWindow', {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  getSize: () => ipcRenderer.invoke('window-get-size'),
  setSize: (width: number, height: number) => ipcRenderer.invoke('window-set-size', width, height),
  setFullscreen: () => ipcRenderer.invoke('window-set-fullscreen'),
  onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => {
    ipcRenderer.on('window-fullscreen-changed', (_event: IpcRendererEvent, data: boolean) => callback(data));
  },
  removeFullscreenListener: () => {
    // NOTE: channel-global removeAllListeners (matches the mpv/updater pattern). Fine while App is
    // the only subscriber; if a second component ever listens on this channel, switch to a stored
    // callback + ipcRenderer.removeListener so this cleanup doesn't clobber the other subscriber.
    ipcRenderer.removeAllListeners('window-fullscreen-changed');
  },
} satisfies ElectronWindowApi);

// Expose mpv API to the renderer process
contextBridge.exposeInMainWorld('mpv', {
  // Control functions
  load: (url: string, options?: MpvLoadOptions) => ipcRenderer.invoke('mpv-load', url, options),
  play: () => ipcRenderer.invoke('mpv-play'),
  pause: () => ipcRenderer.invoke('mpv-pause'),
  togglePause: () => ipcRenderer.invoke('mpv-toggle-pause'),
  stop: () => ipcRenderer.invoke('mpv-stop'),
  setVolume: (volume: number) => ipcRenderer.invoke('mpv-volume', volume),
  toggleMute: () => ipcRenderer.invoke('mpv-toggle-mute'),
  toggleStats: (persistent: boolean) => ipcRenderer.invoke('mpv-toggle-stats', persistent),
  seek: (seconds: number) => ipcRenderer.invoke('mpv-seek', seconds),
  getStatus: () => ipcRenderer.invoke('mpv-get-status'),
  getMode: () => ipcRenderer.invoke('mpv-get-mode'),

  // Event listeners
  onReady: (callback: (ready: boolean) => void) => {
    ipcRenderer.on('mpv-ready', (_event: IpcRendererEvent, data: boolean) => callback(data));
  },
  onStatus: (callback: (status: MpvStatus) => void) => {
    ipcRenderer.on('mpv-status', (_event: IpcRendererEvent, data: MpvStatus) => callback(data));
  },
  onError: (callback: (error: string) => void) => {
    ipcRenderer.on('mpv-error', (_event: IpcRendererEvent, data: string) => callback(data));
  },
  onStreamRecovery: (callback: (update: StreamRecoveryUpdate) => void) => {
    const listener = (_event: IpcRendererEvent, data: StreamRecoveryUpdate) => callback(data);
    ipcRenderer.on('stream-recovery', listener);
    return () => { ipcRenderer.removeListener('stream-recovery', listener); };
  },
  onMediaLoaded: (callback: (update: MediaLoadedUpdate) => void) => {
    const listener = (_event: IpcRendererEvent, data: MediaLoadedUpdate) => callback(data);
    ipcRenderer.on('media-loaded', listener);
    return () => { ipcRenderer.removeListener('media-loaded', listener); };
  },
  onRewindState: (callback: (update: RewindStateUpdate | null) => void) => {
    const listener = (_event: IpcRendererEvent, data: RewindStateUpdate | null) => callback(data);
    ipcRenderer.on('rewind-state', listener);
    return () => { ipcRenderer.removeListener('rewind-state', listener); };
  },

  // Cleanup
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('mpv-ready');
    ipcRenderer.removeAllListeners('mpv-status');
    ipcRenderer.removeAllListeners('mpv-error');
  },
} satisfies MpvApi);

// Subtitles: mpv's subtitle tracks for the current stream, and the choice back
interface SubtitleTrack { id: number; lang: string | null; title: string | null; codec: string; isCc: boolean; external: boolean; externalFile: string | null; hearingImpaired: boolean }
interface SubtitleTracksUpdate { generation: number; tracks: SubtitleTrack[]; duration: number }
interface CcStateUpdate { generation: number; state: 'checking' | 'ok' | 'other-language' | 'unreadable'; language: 'en' | 'es' | 'fr' | null }
contextBridge.exposeInMainWorld('subtitles', {
  setTrack: (generation: number, id: number | null, visible: boolean) => ipcRenderer.invoke('subtitle-set-track', generation, id, visible),
  setVisible: (generation: number, visible: boolean) => ipcRenderer.invoke('subtitle-set-visible', generation, visible),
  setDelay: (generation: number, seconds: number) => ipcRenderer.invoke('subtitle-set-delay', generation, seconds),
  onTracks: (callback: (update: SubtitleTracksUpdate) => void) => {
    const listener = (_event: IpcRendererEvent, data: SubtitleTracksUpdate) => callback(data);
    ipcRenderer.on('subtitle-tracks', listener);
    return () => { ipcRenderer.removeListener('subtitle-tracks', listener); };
  },
  onCcState: (callback: (update: CcStateUpdate) => void) => {
    const listener = (_event: IpcRendererEvent, data: CcStateUpdate) => callback(data);
    ipcRenderer.on('subtitle-cc-state', listener);
    return () => { ipcRenderer.removeListener('subtitle-cc-state', listener); };
  },
});

// Downloaded subtitles (SubDL): main does every request and file; the page only asks
contextBridge.exposeInMainWorld('subdl', {
  languages: () => ipcRenderer.invoke('subdl-languages'),
  checkKey: (key: string) => ipcRenderer.invoke('subdl-check-key', key),
  usage: () => ipcRenderer.invoke('subdl-usage'),
  find: (title: unknown, language: string) => ipcRenderer.invoke('subdl-find', title, language),
  load: (generation: number, title: unknown, nId: string, language: string, duration: number) => ipcRenderer.invoke('subdl-load', generation, title, nId, language, duration),
  cues: (generation: number, nId: string, around: number, delay: number, speed: number, span: number) => ipcRenderer.invoke('subdl-cues', generation, nId, around, delay, speed, span),
  setSpeed: (generation: number, speed: number) => ipcRenderer.invoke('subtitle-set-speed', generation, speed),
});

// Settings > Privacy: what IP outside services see (asks Mullvad's checker, only when called)
interface IpCheckResult { ip: string; city: string | null; country: string | null; organization: string | null; mullvadServer: string | null }
interface StorageProtection { platform: string; available: boolean; backend: string | null; launchKeyring: string | null }
contextBridge.exposeInMainWorld('privacy', {
  checkIp: (): Promise<{ success?: boolean; data?: IpCheckResult; error?: string }> => ipcRenderer.invoke('privacy-check-ip'),
  storageProtection: (): Promise<StorageProtection> => ipcRenderer.invoke('privacy-storage-protection'),
  switchKeyring: (keyring: string): Promise<{ success?: boolean; error?: string }> => ipcRenderer.invoke('privacy-switch-keyring', keyring),
});

// Settings > Backup & transfer: the opened file stays in main, keyed by a token
contextBridge.exposeInMainWorld('setup', {
  exportSetup: (req: { parts: string[]; lists: unknown; playlists: Record<string, string> }) => ipcRenderer.invoke('setup:export', req),
  pick: () => ipcRenderer.invoke('setup:pick'),
  unlock: (token: string, passphrase: string) => ipcRenderer.invoke('setup:unlock', token, passphrase),
  backups: () => ipcRenderer.invoke('setup:backups'),
  openBackup: (name: string) => ipcRenderer.invoke('setup:openBackup', name),
  apply: (token: string, opts: { backupFirst: boolean; currentLists: unknown; currentPlaylists: Record<string, string> }) => ipcRenderer.invoke('setup:apply', token, opts),
  relaunch: () => ipcRenderer.invoke('setup:relaunch'),
  showFile: () => ipcRenderer.invoke('setup:showFile'),
  pendingPlaylists: () => ipcRenderer.invoke('setup:pendingPlaylists'),
  settlePlaylists: (sourceIds: string[]) => ipcRenderer.invoke('setup:settlePlaylists', sourceIds),
});

// Colors the desktop provides, for Settings > Appearance
interface DesktopColors {
  accent: string | null;
  caelestia: Record<string, string> | null;
}
contextBridge.exposeInMainWorld('appearance', {
  getDesktopColors: (): Promise<DesktopColors> => ipcRenderer.invoke('appearance-get-desktop-colors'),
  onDesktopColorsChanged: (callback: (colors: DesktopColors) => void) => {
    const listener = (_event: IpcRendererEvent, colors: DesktopColors) => callback(colors);
    ipcRenderer.on('appearance-desktop-colors', listener);
    return () => { ipcRenderer.removeListener('appearance-desktop-colors', listener); };
  },
});

// Expose storage API for sources and settings
contextBridge.exposeInMainWorld('storage', {
  getSources: () => ipcRenderer.invoke('storage-get-sources'),
  getSource: (id: string) => ipcRenderer.invoke('storage-get-source', id),
  saveSource: (source: Source) => ipcRenderer.invoke('storage-save-source', source),
  deleteSource: (id: string) => ipcRenderer.invoke('storage-delete-source', id),
  getSettings: () => ipcRenderer.invoke('storage-get-settings'),
  updateSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('storage-update-settings', settings),
  isEncryptionAvailable: () => ipcRenderer.invoke('storage-is-encryption-available'),
  importM3UFile: () => ipcRenderer.invoke('import-m3u-file'),
} satisfies StorageApi);

// Expose fetch proxy API - bypasses CORS for API calls
// Data process port: main hands a MessagePort over IPC; pass it into the page's
// world. The renderer's DataClient listens for exactly this message.
ipcRenderer.on('data-port', (event: IpcRendererEvent) => {
  window.postMessage('data-port', '*', event.ports);
});
contextBridge.exposeInMainWorld('data', {
  requestPort: () => ipcRenderer.send('data-request-port'),
});

contextBridge.exposeInMainWorld('fetchProxy', {
  fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) =>
    ipcRenderer.invoke('fetch-proxy', url, options),
  fetchBinary: (url: string) =>
    ipcRenderer.invoke('fetch-binary', url),
} satisfies FetchProxyApi);

// Expose platform info for conditional UI (e.g., resize grip on Windows only)
const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
const isLinuxNonAppImage = process.platform === 'linux' && !process.env.APPIMAGE;

contextBridge.exposeInMainWorld('platform', {
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  isDev: process.argv.includes('--dev'),
  isPortable,
  isLinuxNonAppImage,
  supportsAutoUpdate: !isPortable && !isLinuxNonAppImage,
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  rewindCapBytes: () => ipcRenderer.invoke('rewind-cap-bytes'),
} satisfies PlatformApi);

// Expose debug API for logging
contextBridge.exposeInMainWorld('debug', {
  getLogPath: () => ipcRenderer.invoke('debug-get-log-path'),
  logFromRenderer: (message: string) => ipcRenderer.invoke('debug-log-renderer', message),
  reportPreview: (syncStatus: unknown) => ipcRenderer.invoke('debug-report-preview', syncStatus),
  saveReport: (syncStatus: unknown) => ipcRenderer.invoke('debug-report-save', syncStatus),
  openLogFolder: () => ipcRenderer.invoke('debug-open-log-folder'),
  isEnabled: () => ipcRenderer.invoke('debug-is-enabled'),
  getIncludeAddresses: () => ipcRenderer.invoke('debug-get-include-addresses'),
  setIncludeAddresses: (on: boolean) => ipcRenderer.invoke('debug-set-include-addresses', on),
  getSourceLegend: () => ipcRenderer.invoke('debug-get-source-legend'),
  onEnabledChanged: (callback: (enabled: boolean) => void) => {
    const listener = (_event: IpcRendererEvent, enabled: boolean) => callback(enabled);
    ipcRenderer.on('debug-logging-changed', listener);
    return () => { ipcRenderer.removeListener('debug-logging-changed', listener); };
  },
} satisfies DebugApi);

// Expose auto-updater API (types defined in electron.d.ts)
contextBridge.exposeInMainWorld('updater', {
  onUpdateAvailable: (callback: (info: { version: string; releaseDate: string }) => void) => {
    ipcRenderer.on('updater-update-available', (_event: IpcRendererEvent, info) => callback(info));
  },
  onUpdateDownloaded: (callback: (info: { version: string; releaseDate: string }) => void) => {
    ipcRenderer.on('updater-update-downloaded', (_event: IpcRendererEvent, info) => callback(info));
  },
  onDownloadProgress: (callback: (progress: { percent: number }) => void) => {
    ipcRenderer.on('updater-download-progress', (_event: IpcRendererEvent, progress) => callback(progress));
  },
  onError: (callback: (error: { message: string }) => void) => {
    ipcRenderer.on('updater-error', (_event: IpcRendererEvent, error) => callback(error));
  },
  checkForUpdates: () => ipcRenderer.invoke('updater-check'),
  installUpdate: () => ipcRenderer.invoke('updater-install'),
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('updater-update-available');
    ipcRenderer.removeAllListeners('updater-update-downloaded');
    ipcRenderer.removeAllListeners('updater-download-progress');
    ipcRenderer.removeAllListeners('updater-error');
  },
});

// Shared texture API for GPU-accelerated video rendering (Electron 40+)
// This allows the renderer to receive VideoFrames from the main process
export interface SharedTextureApi {
  onFrame: (callback: (videoFrame: VideoFrame, index: number) => void) => void;
  removeFrameListener: () => void;
  onClear: (callback: () => void) => void;
  removeClearListener: () => void;
  /** Report whether the renderer could draw the latest frame; errors escalate in main. */
  reportDrawResult: (ok: boolean, message?: string) => void;
  reportPipelineFailure: (message: string) => void;
  /** Linux frame pacing: how far (ms) the shown picture trails frame arrival */
  reportPresentationDelay: (delayMs: number) => void;
  isAvailable: boolean;
}

// Static platform gate: darwin/linux CAN receive sharedTexture frames. Whether
// native mpv actually initialized this launch is reported by 'mpv-get-mode'.
// Windows continues to render external mpv behind the BrowserWindow via --wid.
let sharedTextureAvailable = false;
if (process.platform === 'darwin' || process.platform === 'linux') {
  try {
    const { sharedTexture } = require('electron');
    sharedTextureAvailable = !!sharedTexture?.setSharedTextureReceiver;
  } catch (error) {
    console.debug('[preload] sharedTexture API not available:', error);
    sharedTextureAvailable = false;
  }
}

// Frame callback storage
let frameCallback: ((videoFrame: VideoFrame, index: number) => void) | null = null;
let clearCallback: (() => void) | null = null;

// Renderer-side frame failures (import or draw) are otherwise invisible to the
// main process. Every failure is forwarded; recovery is sent once per episode.
let rendererFrameFailed = false;
function reportFrameOutcome(ok: boolean, message?: string): void {
  if (ok) {
    if (!rendererFrameFailed) return;
    rendererFrameFailed = false;
    ipcRenderer.send('shared-texture-frame-ok');
    return;
  }
  rendererFrameFailed = true;
  ipcRenderer.send('shared-texture-frame-error', message ?? 'unknown error');
}

interface SharedTextureFrameMetadata {
  generation: number;
  index: number;
}

function isSharedTextureFrameMetadata(value: unknown): value is SharedTextureFrameMetadata {
  if (!value || typeof value !== 'object') return false;
  const metadata = value as Record<string, unknown>;
  return typeof metadata.generation === 'number' && Number.isSafeInteger(metadata.generation) && metadata.generation >= 0 &&
    typeof metadata.index === 'number' && Number.isSafeInteger(metadata.index) && metadata.index >= 0;
}

class SharedTextureFrameOrder {
  private generation = 0;
  private lastFrameIndex = -1;

  shouldClear(generation: unknown): boolean {
    if (!Number.isSafeInteger(generation) || Number(generation) < 0 || Number(generation) <= this.generation) {
      return false;
    }
    this.generation = Number(generation);
    this.lastFrameIndex = -1;
    return true;
  }

  acceptFrame(metadata: SharedTextureFrameMetadata): boolean {
    if (metadata.generation < this.generation) return false;
    if (metadata.generation > this.generation) {
      this.generation = metadata.generation;
      this.lastFrameIndex = -1;
    }
    if (metadata.index <= this.lastFrameIndex) return false;
    this.lastFrameIndex = metadata.index;
    return true;
  }
}

const sharedTextureFrameOrder = new SharedTextureFrameOrder();

// Listen for clear signal from main process (content switch)
ipcRenderer.on('video-clear', (_event, generation: unknown) => {
  if (sharedTextureFrameOrder.shouldClear(generation)) clearCallback?.();
});

// Set up frame receiver if available
if (sharedTextureAvailable) {
  try {
    const { sharedTexture } = require('electron');
    sharedTexture.setSharedTextureReceiver(async (data: { importedSharedTexture: { getVideoFrame: () => VideoFrame; release: () => void } }, ...args: unknown[]) => {
      const imported = data.importedSharedTexture;
      try {
        const metadata = args[0];
        if (!isSharedTextureFrameMetadata(metadata) || !sharedTextureFrameOrder.acceptFrame(metadata)) {
          imported?.release();
          return;
        }
        if (frameCallback && imported) {
          const videoFrame = imported.getVideoFrame();
          // VideoCanvas owns the frame and closes it after drawing or discarding it.
          frameCallback(videoFrame, metadata.index);
          imported.release();
        } else if (imported) {
          imported.release();
        }
      } catch (error) {
        console.error('[preload] sharedTexture error:', error);
        reportFrameOutcome(false, error instanceof Error ? error.message : String(error));
        try { imported?.release(); } catch { /* ignore */ }
      }
    });
  } catch (error) {
    console.warn('[preload] Failed to set up sharedTexture receiver:', error);
    sharedTextureAvailable = false;
  }
}

contextBridge.exposeInMainWorld('sharedTexture', {
  onFrame: (callback: (videoFrame: VideoFrame, index: number) => void) => {
    frameCallback = callback;
  },
  removeFrameListener: () => {
    frameCallback = null;
  },
  onClear: (callback: () => void) => {
    clearCallback = callback;
  },
  removeClearListener: () => {
    clearCallback = null;
  },
  reportDrawResult: (ok: boolean, message?: string) => {
    reportFrameOutcome(ok === true, typeof message === 'string' ? message : undefined);
  },
  reportPipelineFailure: (message: string) => {
    if (typeof message === 'string') ipcRenderer.send('shared-texture-pipeline-failure', message);
  },
  reportPresentationDelay: (delayMs: number) => {
    if (typeof delayMs === 'number' && Number.isFinite(delayMs)) ipcRenderer.send('shared-texture-presentation-delay', delayMs);
  },
  isAvailable: sharedTextureAvailable,
} satisfies SharedTextureApi);
