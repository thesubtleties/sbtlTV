import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Source } from '@sbtltv/core';

// Types for the exposed APIs
export interface MpvStatus {
  playing: boolean;
  volume: number;
  muted: boolean;
  position: number;
  duration: number;
}

export interface MpvResult {
  success?: boolean;
  error?: string;
}

export interface MpvApi {
  load: (url: string) => Promise<MpvResult>;
  play: () => Promise<MpvResult>;
  pause: () => Promise<MpvResult>;
  togglePause: () => Promise<MpvResult>;
  stop: () => Promise<MpvResult>;
  setVolume: (volume: number) => Promise<MpvResult>;
  toggleMute: () => Promise<MpvResult>;
  seek: (seconds: number) => Promise<MpvResult>;
  getStatus: () => Promise<MpvStatus>;
  initRenderer?: (width: number, height: number) => { buffer: ArrayBuffer; width: number; height: number; stride: number } | null;
  setSize?: (width: number, height: number) => { buffer: ArrayBuffer; width: number; height: number; stride: number } | null;
  renderFrame?: () => boolean;
  isLibmpv?: boolean;
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
}

export interface StorageResult<T = void> {
  success?: boolean;
  error?: string;
  data?: T;
}

export interface AppSettings {
  theme: 'dark' | 'light';
  lastSourceId?: string;
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

// Expose window control API
contextBridge.exposeInMainWorld('electronWindow', {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  getSize: () => ipcRenderer.invoke('window-get-size'),
  setSize: (width: number, height: number) => ipcRenderer.invoke('window-set-size', width, height),
} satisfies ElectronWindowApi);

const isLinux = process.platform === 'linux';

type MpvFrame = { buffer: ArrayBuffer; width: number; height: number; stride: number };

const readyListeners = new Set<(ready: boolean) => void>();
const statusListeners = new Set<(status: MpvStatus) => void>();
const errorListeners = new Set<(error: string) => void>();

let mpvReady = false;
let mpvPollTimer: NodeJS.Timeout | null = null;
let mpvNative: any = null;

if (isLinux) {
  const packagedPath = path.join(process.resourcesPath, 'native', 'mpv.node');
  const devPath = path.join(__dirname, '../native/mpv/build/Release/mpv.node');
  const addonPath = fs.existsSync(packagedPath) ? packagedPath : devPath;
  try {
    mpvNative = require(addonPath);
  } catch (error) {
    mpvNative = null;
    console.error('[libmpv] Failed to load native module:', error);
  }
}

const emitReady = (ready: boolean) => {
  mpvReady = ready;
  readyListeners.forEach((callback) => callback(ready));
};

const emitStatus = (status: MpvStatus) => {
  statusListeners.forEach((callback) => callback(status));
};

const emitError = (message: string) => {
  errorListeners.forEach((callback) => callback(message));
};

const startStatusPolling = () => {
  if (mpvPollTimer || !mpvNative) return;
  mpvPollTimer = setInterval(() => {
    try {
      const status = mpvNative.getStatus?.();
      if (status) emitStatus(status as MpvStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown libmpv error';
      emitError(message);
    }
  }, 250);
};

const mpvApi: MpvApi = isLinux
  ? {
    load: async (url: string) => {
      if (!mpvNative?.isInitialized?.()) return { error: 'libmpv not initialized' };
      return mpvNative.load(url) ? { success: true } : { error: 'mpv load failed' };
    },
    play: async () => (mpvNative?.play?.() ? { success: true } : { error: 'mpv play failed' }),
    pause: async () => (mpvNative?.pause?.() ? { success: true } : { error: 'mpv pause failed' }),
    togglePause: async () => (mpvNative?.togglePause?.() ? { success: true } : { error: 'mpv toggle failed' }),
    stop: async () => (mpvNative?.stop?.() ? { success: true } : { error: 'mpv stop failed' }),
    setVolume: async (volume: number) => (mpvNative?.setVolume?.(volume) ? { success: true } : { error: 'mpv volume failed' }),
    toggleMute: async () => (mpvNative?.toggleMute?.() ? { success: true } : { error: 'mpv mute failed' }),
    seek: async (seconds: number) => (mpvNative?.seek?.(seconds) ? { success: true } : { error: 'mpv seek failed' }),
    getStatus: async () => {
      if (!mpvNative?.getStatus) {
        return { playing: false, volume: 0, muted: false, position: 0, duration: 0 };
      }
      return mpvNative.getStatus() as MpvStatus;
    },
    initRenderer: (width: number, height: number) => {
      if (!mpvNative) {
        emitError('libmpv not available - install libmpv-dev');
        return null;
      }
      if (!mpvNative.isInitialized?.()) {
        const ok = mpvNative.init?.();
        if (!ok) {
          emitError('libmpv init failed');
          return null;
        }
      }
      const frame = mpvNative.setSize?.(width, height) as MpvFrame | null;
      if (!frame) {
        emitError('libmpv setSize failed');
        return null;
      }
      emitReady(true);
      startStatusPolling();
      return frame;
    },
    setSize: (width: number, height: number) => {
      if (!mpvNative?.setSize) return null;
      return mpvNative.setSize(width, height) as MpvFrame | null;
    },
    renderFrame: () => (mpvNative?.renderFrame?.() ? true : false),
    isLibmpv: true,
    onReady: (callback: (ready: boolean) => void) => {
      readyListeners.add(callback);
      if (mpvReady) callback(true);
    },
    onStatus: (callback: (status: MpvStatus) => void) => {
      statusListeners.add(callback);
    },
    onError: (callback: (error: string) => void) => {
      errorListeners.add(callback);
    },
    removeAllListeners: () => {
      readyListeners.clear();
      statusListeners.clear();
      errorListeners.clear();
      if (mpvPollTimer) {
        clearInterval(mpvPollTimer);
        mpvPollTimer = null;
      }
    },
  }
  : {
    load: (url: string) => ipcRenderer.invoke('mpv-load', url),
    play: () => ipcRenderer.invoke('mpv-play'),
    pause: () => ipcRenderer.invoke('mpv-pause'),
    togglePause: () => ipcRenderer.invoke('mpv-toggle-pause'),
    stop: () => ipcRenderer.invoke('mpv-stop'),
    setVolume: (volume: number) => ipcRenderer.invoke('mpv-volume', volume),
    toggleMute: () => ipcRenderer.invoke('mpv-toggle-mute'),
    seek: (seconds: number) => ipcRenderer.invoke('mpv-seek', seconds),
    getStatus: () => ipcRenderer.invoke('mpv-get-status'),
    onReady: (callback: (ready: boolean) => void) => {
      ipcRenderer.on('mpv-ready', (_event: IpcRendererEvent, data: boolean) => callback(data));
    },
    onStatus: (callback: (status: MpvStatus) => void) => {
      ipcRenderer.on('mpv-status', (_event: IpcRendererEvent, data: MpvStatus) => callback(data));
    },
    onError: (callback: (error: string) => void) => {
      ipcRenderer.on('mpv-error', (_event: IpcRendererEvent, data: string) => callback(data));
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('mpv-ready');
      ipcRenderer.removeAllListeners('mpv-status');
      ipcRenderer.removeAllListeners('mpv-error');
    },
  };

contextBridge.exposeInMainWorld('mpv', mpvApi);

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
} satisfies FetchProxyApi);

// Expose platform info for conditional UI (e.g., resize grip on Windows only)
contextBridge.exposeInMainWorld('platform', {
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
});
