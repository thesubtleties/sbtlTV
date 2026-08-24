import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron/renderer';
import type { Source } from '@sbtltv/core';

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

export interface MpvModeInfo {
  mode: 'native' | 'external';
  sharedTextureAvailable: boolean;
}

export interface MpvApi {
  load: (url: string, startPosition?: number) => Promise<MpvResult>;
  play: () => Promise<MpvResult>;
  pause: () => Promise<MpvResult>;
  togglePause: () => Promise<MpvResult>;
  stop: () => Promise<MpvResult>;
  setVolume: (volume: number) => Promise<MpvResult>;
  toggleMute: () => Promise<MpvResult>;
  seek: (seconds: number) => Promise<MpvResult>;
  getStatus: () => Promise<MpvStatus>;
  getMode: () => Promise<MpvModeInfo>;
  onReady: (callback: (ready: boolean) => void) => void;
  onStatus: (callback: (status: MpvStatus) => void) => void;
  onError: (callback: (error: string) => void) => void;
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

export interface AppSettings {
  theme: 'dark' | 'light';
  lastSourceId?: string;
  autoUpdateEnabled?: boolean;
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
  fetchAndParseEpg: (url: string, providerChannels?: { epg_channel_id: string; name: string; stream_id: string }[]) => Promise<StorageResult<{ channels: { id: string; displayNames: string[] }[]; programs: { channel_id: string; title: string; description: string; start: string; stop: string }[] }>>;
}

export interface DebugApi {
  getLogPath: () => Promise<StorageResult<string>>;
  logFromRenderer: (message: string) => Promise<StorageResult>;
  openLogFolder: () => Promise<StorageResult>;
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
  load: (url: string, startPosition?: number) => ipcRenderer.invoke('mpv-load', url, startPosition),
  play: () => ipcRenderer.invoke('mpv-play'),
  pause: () => ipcRenderer.invoke('mpv-pause'),
  togglePause: () => ipcRenderer.invoke('mpv-toggle-pause'),
  stop: () => ipcRenderer.invoke('mpv-stop'),
  setVolume: (volume: number) => ipcRenderer.invoke('mpv-volume', volume),
  toggleMute: () => ipcRenderer.invoke('mpv-toggle-mute'),
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

  // Cleanup
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('mpv-ready');
    ipcRenderer.removeAllListeners('mpv-status');
    ipcRenderer.removeAllListeners('mpv-error');
  },
} satisfies MpvApi);

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
contextBridge.exposeInMainWorld('fetchProxy', {
  fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) =>
    ipcRenderer.invoke('fetch-proxy', url, options),
  fetchBinary: (url: string) =>
    ipcRenderer.invoke('fetch-binary', url),
  fetchAndParseEpg: (url: string, providerChannels?: { epg_channel_id: string; name: string; stream_id: string }[]) =>
    ipcRenderer.invoke('fetch-and-parse-epg', url, providerChannels),
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
} satisfies PlatformApi);

// Expose debug API for logging
contextBridge.exposeInMainWorld('debug', {
  getLogPath: () => ipcRenderer.invoke('debug-get-log-path'),
  logFromRenderer: (message: string) => ipcRenderer.invoke('debug-log-renderer', message),
  openLogFolder: () => ipcRenderer.invoke('debug-open-log-folder'),
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
  isAvailable: boolean;
}

// Check if sharedTexture is available on platforms that use native mpv. Windows
// continues to render external mpv behind the BrowserWindow via --wid.
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
          // Don't close videoFrame here - VideoCanvas manages frame lifecycle via rAF
          // It will close the previous frame when a new one arrives
          frameCallback(videoFrame, metadata.index);
          imported.release();
        } else if (imported) {
          imported.release();
        }
      } catch (error) {
        console.error('[preload] sharedTexture error:', error);
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
  isAvailable: sharedTextureAvailable,
} satisfies SharedTextureApi);
