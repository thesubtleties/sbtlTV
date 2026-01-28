import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { Source } from '@sbtltv/core';

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';
const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};
const logLevelName = (process.env.SBTLTV_LOG_LEVEL || 'info').toLowerCase() as LogLevel;
const logLevel = LOG_LEVELS[logLevelName] ?? LOG_LEVELS.info;

const serializeArg = (arg: unknown): unknown => {
  if (arg instanceof Error) {
    return { __error: true, message: arg.message, stack: arg.stack };
  }
  if (typeof arg === 'bigint') return `${arg.toString()}n`;
  if (arg === undefined) return 'undefined';
  try {
    return JSON.parse(JSON.stringify(arg));
  } catch {
    return String(arg);
  }
};

const sendLog = (level: LogLevel, tag: string, args: unknown[]): void => {
  if (LOG_LEVELS[level] > logLevel) return;
  ipcRenderer.send('log-event', { level, tag, args: args.map(serializeArg) });
};

const patchRendererConsole = (): void => {
  const marker = '__SBTLTV_LOG_PATCHED__';
  if ((globalThis as unknown as Record<string, boolean>)[marker]) return;
  (globalThis as unknown as Record<string, boolean>)[marker] = true;

  const original = { ...console };
  console.log = (...args: unknown[]) => {
    sendLog('info', 'renderer', args);
    original.log(...args);
  };
  console.info = (...args: unknown[]) => {
    sendLog('info', 'renderer', args);
    original.info(...args);
  };
  console.warn = (...args: unknown[]) => {
    sendLog('warn', 'renderer', args);
    original.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    sendLog('error', 'renderer', args);
    original.error(...args);
  };
  console.debug = (...args: unknown[]) => {
    sendLog('debug', 'renderer', args);
    original.debug(...args);
  };
  console.trace = (...args: unknown[]) => {
    sendLog('trace', 'renderer', args);
    original.trace(...args);
  };
};

patchRendererConsole();
process.on('uncaughtException', (error) => sendLog('error', 'renderer', ['uncaughtException', error]));
process.on('unhandledRejection', (reason) => sendLog('error', 'renderer', ['unhandledRejection', reason]));
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => sendLog('error', 'renderer', ['window.error', event.message]));
  window.addEventListener('unhandledrejection', (event) => sendLog('error', 'renderer', ['window.unhandledrejection', event.reason]));
}

// Types for the exposed APIs
export interface MpvStatus {
  playing: boolean;
  volume: number;
  muted: boolean;
  position: number;
  duration: number;
  hwdec?: string;
  hwdecSetting?: string;
  hwdecInterop?: string;
  hwdecAvailable?: string;
  hwdecCodecs?: string;
  gpuHwdecInterop?: string;
  vo?: string;
  gpuApi?: string;
  gpuContext?: string;
  videoCodec?: string;
}

export interface MpvViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  hidden?: boolean;
}

export interface MpvFrameInfo {
  width: number;
  height: number;
  stride: number;
  format: 'RGBA';
  pts: number;
  frameId: number;
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
  setViewport: (rect: MpvViewport) => Promise<MpvResult>;
  onFrame: (callback: (frame: { info: MpvFrameInfo; data: ArrayBuffer }) => void) => void;
  onVideoInfo: (callback: (info: MpvFrameInfo) => void) => void;
  onReady: (callback: (ready: boolean) => void) => void;
  onStatus: (callback: (status: MpvStatus) => void) => void;
  onWarning: (callback: (warning: string) => void) => void;
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

const readyListeners = new Set<(ready: boolean) => void>();
const statusListeners = new Set<(status: MpvStatus) => void>();
const warningListeners = new Set<(warning: string) => void>();
const errorListeners = new Set<(error: string) => void>();
const frameListeners = new Set<(frame: { info: MpvFrameInfo; data: ArrayBuffer }) => void>();
const videoInfoListeners = new Set<(info: MpvFrameInfo) => void>();
let lastReady: boolean | null = null;

ipcRenderer.on('mpv-ready', (_event: IpcRendererEvent, data: boolean) => {
  lastReady = data;
  readyListeners.forEach((callback) => callback(data));
});
ipcRenderer.on('mpv-status', (_event: IpcRendererEvent, data: MpvStatus) => {
  statusListeners.forEach((callback) => callback(data));
});
ipcRenderer.on('mpv-warning', (_event: IpcRendererEvent, data: string) => {
  warningListeners.forEach((callback) => callback(data));
});
ipcRenderer.on('mpv-error', (_event: IpcRendererEvent, data: string) => {
  errorListeners.forEach((callback) => callback(data));
});

ipcRenderer.on('player-video-info', (_event: IpcRendererEvent, info: MpvFrameInfo) => {
  videoInfoListeners.forEach((callback) => callback(info));
});

ipcRenderer.on('player-frame', (_event: IpcRendererEvent, payload: { info: MpvFrameInfo; data: ArrayBuffer }) => {
  frameListeners.forEach((callback) => callback({ info: payload.info, data: payload.data }));
});

const mpvApi: MpvApi = {
  load: (url: string) => ipcRenderer.invoke('mpv-load', url),
  play: () => ipcRenderer.invoke('mpv-play'),
  pause: () => ipcRenderer.invoke('mpv-pause'),
  togglePause: () => ipcRenderer.invoke('mpv-toggle-pause'),
  stop: () => ipcRenderer.invoke('mpv-stop'),
  setVolume: (volume: number) => ipcRenderer.invoke('mpv-volume', volume),
  toggleMute: () => ipcRenderer.invoke('mpv-toggle-mute'),
  seek: (seconds: number) => ipcRenderer.invoke('mpv-seek', seconds),
  getStatus: () => ipcRenderer.invoke('mpv-get-status'),
  setViewport: (rect: MpvViewport) => ipcRenderer.invoke('mpv-set-viewport', rect),
  onFrame: (callback: (frame: { info: MpvFrameInfo; data: ArrayBuffer }) => void) => {
    frameListeners.add(callback);
  },
  onVideoInfo: (callback: (info: MpvFrameInfo) => void) => {
    videoInfoListeners.add(callback);
  },
  onReady: (callback: (ready: boolean) => void) => {
    readyListeners.add(callback);
    if (lastReady !== null) callback(lastReady);
  },
  onStatus: (callback: (status: MpvStatus) => void) => {
    statusListeners.add(callback);
  },
  onWarning: (callback: (warning: string) => void) => {
    warningListeners.add(callback);
  },
  onError: (callback: (error: string) => void) => {
    errorListeners.add(callback);
  },
  removeAllListeners: () => {
    readyListeners.clear();
    statusListeners.clear();
    warningListeners.clear();
    errorListeners.clear();
    frameListeners.clear();
    videoInfoListeners.clear();
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
