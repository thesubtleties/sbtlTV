import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
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

const parseEnvInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const renderFps = parseEnvInt(process.env.SBTLTV_RENDER_FPS, 30);
const renderMaxWidth = parseEnvInt(process.env.SBTLTV_RENDER_MAX_WIDTH, 1920);
const renderMaxHeight = parseEnvInt(process.env.SBTLTV_RENDER_MAX_HEIGHT, 1080);
const hwdecGraceMs = parseEnvInt(process.env.SBTLTV_HWDEC_GRACE_MS, 5000);
const allowSwDec = process.env.SBTLTV_ALLOW_SWDEC !== '0';
const enforceHwdec = process.env.SBTLTV_HWDEC_ENFORCE !== '0';

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

const logPreload = (level: LogLevel, ...args: unknown[]): void => {
  sendLog(level, 'preload', args);
  const logger = {
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
    trace: console.trace,
  }[level];
  logger('[preload]', ...args);
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
  attachCanvas?: (canvasId: string) => boolean;
  isLibmpv?: boolean;
  onReady: (callback: (ready: boolean) => void) => void;
  onStatus: (callback: (status: MpvStatus) => void) => void;
  onWarning?: (callback: (warning: string) => void) => void;
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
const useLibmpv = isLinux && process.env.SBTLTV_DISABLE_LIBMPV !== '1';

type MpvFrame = { buffer: ArrayBuffer; width: number; height: number; stride: number };

const readyListeners = new Set<(ready: boolean) => void>();
const statusListeners = new Set<(status: MpvStatus) => void>();
const errorListeners = new Set<(error: string) => void>();
const warningListeners = new Set<(warning: string) => void>();

let mpvReady = false;
let mpvPollTimer: NodeJS.Timeout | null = null;
let mpvNative: any = null;
let mpvAddonPath: string | null = null;
let lastMpvErrorLog = '';
const lastMpvStatusMeta: Record<string, string> = {};
let hwdecDeadline = 0;
let hwdecSatisfied = false;
let lastHwdecError = '';
let hwdecWarned = false;
type PendingLoad = {
  resolve: (result: MpvResult) => void;
  deadline: number;
  url: string;
};
let pendingLoad: PendingLoad | null = null;
let renderCanvas: HTMLCanvasElement | null = null;
let renderCtx: CanvasRenderingContext2D | null = null;
let renderImage: ImageData | null = null;
let activeFrame: MpvFrame | null = null;
let activeSrc: Uint8Array | null = null;
let renderTimer: NodeJS.Timeout | null = null;
let renderObserver: ResizeObserver | null = null;

if (isLinux) {
  const prependEnvPath = (key: string, value: string): void => {
    if (!value || !fs.existsSync(value)) return;
    const current = process.env[key];
    const parts = current ? current.split(path.delimiter) : [];
    if (!parts.includes(value)) {
      process.env[key] = [value, ...parts].filter(Boolean).join(path.delimiter);
    }
  };

  if (process.env.SBTLTV_USE_SYSTEM_LIBMPV !== '1') {
    const packagedLibDir = path.join(process.resourcesPath, 'native', 'lib');
    const distLibDir = path.join(__dirname, '../dist/native/lib');
    const libDir = fs.existsSync(packagedLibDir) ? packagedLibDir : (fs.existsSync(distLibDir) ? distLibDir : null);
    if (libDir) {
      prependEnvPath('LD_LIBRARY_PATH', libDir);
      const libmpvPath = path.join(libDir, 'libmpv.so.2');
      if (fs.existsSync(libmpvPath)) {
        process.env.SBTLTV_LIBMPV_PATH = libmpvPath;
      } else {
        logPreload('warn', 'libmpv not found in bundled lib dir', { libDir, libmpvPath });
      }
      try {
        const entries = fs.readdirSync(libDir);
        const ffmpegPresence = {
          avformat: entries.some((entry) => entry.startsWith('libavformat.so')),
          avcodec: entries.some((entry) => entry.startsWith('libavcodec.so')),
          avutil: entries.some((entry) => entry.startsWith('libavutil.so')),
        };
        if (!ffmpegPresence.avformat || !ffmpegPresence.avcodec || !ffmpegPresence.avutil) {
          logPreload('warn', 'bundled ffmpeg libs missing', { libDir, ...ffmpegPresence });
        }
      } catch (error) {
        logPreload('warn', 'failed to scan bundled lib dir', { libDir, error });
      }
    }
  }

  const packagedPath = path.join(process.resourcesPath, 'native', 'mpv.node');
  const distPath = path.join(__dirname, '../dist/native/mpv.node');
  const devPath = path.join(__dirname, '../native/mpv/build/Release/mpv.node');
  mpvAddonPath = fs.existsSync(packagedPath) ? packagedPath : (fs.existsSync(distPath) ? distPath : devPath);
  logPreload('info', 'libmpv paths', {
    mpvAddonPath,
    libmpvPath: process.env.SBTLTV_LIBMPV_PATH,
    ldLibraryPath: process.env.LD_LIBRARY_PATH,
  });
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

const emitWarning = (message: string) => {
  warningListeners.forEach((callback) => callback(message));
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const stopRenderLoop = () => {
  if (renderTimer) {
    clearInterval(renderTimer);
    renderTimer = null;
  }
};

const startRenderLoop = () => {
  if (renderTimer) return;
  const intervalMs = Math.max(1, Math.floor(1000 / Math.max(1, renderFps)));
  renderTimer = setInterval(() => {
    if (!mpvNative || !renderCtx || !renderCanvas || !renderImage || !activeFrame || !activeSrc) return;
    const ok = mpvNative.renderFrame?.();
    if (!ok) {
      const detail = mpvNative.getLastError?.();
      if (detail) {
        logPreload('warn', 'mpv renderFrame failed', detail);
      }
      return;
    }
    const rowBytes = activeFrame.width * 4;
    const stride = activeFrame.stride;
    const dst = renderImage.data;
    for (let y = 0; y < activeFrame.height; y += 1) {
      const srcOff = y * stride;
      const dstOff = y * rowBytes;
      dst.set(activeSrc.subarray(srcOff, srcOff + rowBytes), dstOff);
    }
    renderCtx.putImageData(renderImage, 0, 0);
  }, intervalMs);
};

const resizeFromCanvasRect = () => {
  if (!renderCanvas || !renderCtx || !mpvNative) return;
  const rect = renderCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const rawWidth = Math.max(1, Math.floor(rect.width * dpr));
  const rawHeight = Math.max(1, Math.floor(rect.height * dpr));
  const maxWidth = renderMaxWidth > 0 ? renderMaxWidth : rawWidth;
  const maxHeight = renderMaxHeight > 0 ? renderMaxHeight : rawHeight;
  const scale = Math.min(1, maxWidth / rawWidth, maxHeight / rawHeight);
  const width = clamp(Math.floor(rawWidth * scale), 1, Math.max(1, maxWidth));
  const height = clamp(Math.floor(rawHeight * scale), 1, Math.max(1, maxHeight));
    const frame = mpvNative.setSize?.(width, height) as MpvFrame | null;
    if (!frame) {
      const detail = mpvNative.getLastError?.();
      emitError(detail ? `libmpv setSize failed: ${detail}` : 'libmpv setSize failed');
      return;
    }
    logPreload('info', 'libmpv setSize', {
      width,
      height,
      stride: frame.stride,
      bufferBytes: frame.stride * frame.height,
    });
    activeFrame = frame;
    activeSrc = new Uint8Array(frame.buffer);
    renderCanvas.width = frame.width;
    renderCanvas.height = frame.height;
    renderImage = renderCtx.createImageData(frame.width, frame.height);
};

const settlePendingLoad = (result: MpvResult) => {
  if (!pendingLoad) return;
  const { resolve } = pendingLoad;
  pendingLoad = null;
  resolve(result);
};

const ensureMpvNative = (): boolean => {
  if (mpvNative) return true;
  if (process.env.SBTLTV_DISABLE_LIBMPV === '1') {
    logPreload('warn', 'libmpv disabled via SBTLTV_DISABLE_LIBMPV');
    return false;
  }
  if (!mpvAddonPath) {
    logPreload('error', 'libmpv addon path not set');
    return false;
  }
  try {
    mpvNative = require(mpvAddonPath);
    logPreload('info', 'libmpv addon loaded', mpvAddonPath);
    const buildInfo = mpvNative?.getBuildInfo?.();
    if (buildInfo) {
      logPreload('info', 'libmpv build info', buildInfo);
    }
  } catch (error) {
    mpvNative = null;
    logPreload('error', 'libmpv addon load failed', error);
    return false;
  }
  process.on('exit', () => {
    try {
      mpvNative?.shutdown?.();
    } catch (error) {
      logPreload('error', 'libmpv shutdown failed', error);
    }
  });
  return true;
};

const startStatusPolling = () => {
  if (mpvPollTimer || !mpvNative) return;
  mpvPollTimer = setInterval(() => {
    try {
      const events = mpvNative.pollEvents?.();
      if (events?.lastLog) {
        console.warn('[mpv]', events.lastLog);
      }
      if (events?.fileLoaded) {
        hwdecDeadline = Date.now() + hwdecGraceMs;
        hwdecSatisfied = false;
        hwdecWarned = false;
      }
      if (events?.endFileError) {
        if (events?.lastErrorLog) lastMpvErrorLog = events.lastErrorLog;
        logPreload('warn', 'mpv end-file error', {
          error: events.endFileError,
          code: events.endFileErrorCode,
          lastErrorLog: events.lastErrorLog,
          url: pendingLoad?.url,
        });
        emitError(events?.lastErrorLog || events.endFileError);
        settlePendingLoad({ error: events?.lastErrorLog || events.endFileError });
        hwdecDeadline = 0;
      } else if (events?.lastErrorLog && events.lastErrorLog !== lastMpvErrorLog) {
        lastMpvErrorLog = events.lastErrorLog;
        logPreload('warn', 'mpv error log', events.lastErrorLog);
      }
      if (events?.fileLoaded) {
        logPreload('info', 'mpv file loaded', { url: pendingLoad?.url });
        settlePendingLoad({ success: true });
      }
      const status = mpvNative.getStatus?.();
      if (status) {
        const metaPairs: Array<[string, string | undefined]> = [
          ['hwdec', status.hwdec],
          ['hwdecSetting', status.hwdecSetting],
          ['hwdecInterop', status.hwdecInterop],
          ['hwdecAvailable', status.hwdecAvailable],
          ['hwdecCodecs', status.hwdecCodecs],
          ['gpuHwdecInterop', status.gpuHwdecInterop],
          ['vo', status.vo],
          ['gpuApi', status.gpuApi],
          ['gpuContext', status.gpuContext],
          ['videoCodec', status.videoCodec],
        ];
        for (const [key, value] of metaPairs) {
          if (!value) continue;
          if (lastMpvStatusMeta[key] !== value) {
            lastMpvStatusMeta[key] = value;
            logPreload('info', 'mpv status', { key, value });
          }
        }
        if (!hwdecSatisfied && !hwdecDeadline && status.position >= 0) {
          hwdecDeadline = Date.now() + hwdecGraceMs;
          logPreload('info', 'hwdec grace armed', {
            hwdecCurrent: status.hwdec ?? 'no',
            graceMs: hwdecGraceMs,
          });
        }
        if (pendingLoad && status.position >= 0) {
          logPreload('info', 'mpv load settled from status', {
            url: pendingLoad.url,
            position: status.position,
            duration: status.duration,
          });
          settlePendingLoad({ success: true });
        }
        const hwdecValue = (status.hwdec ?? '').toLowerCase();
        if (hwdecValue && hwdecValue !== 'no') {
          hwdecSatisfied = true;
          hwdecDeadline = 0;
          lastHwdecError = '';
        } else if (!hwdecSatisfied && hwdecDeadline && Date.now() > hwdecDeadline) {
          if (allowSwDec) {
            if (!hwdecWarned) {
              hwdecWarned = true;
              emitWarning(`Hardware decode inactive; falling back to software decode (hwdec-current: ${status.hwdec ?? 'no'})`);
              logPreload('warn', 'hwdec fallback', {
                hwdecCurrent: status.hwdec ?? 'no',
                hwdecSetting: status.hwdecSetting ?? 'unknown',
                videoCodec: status.videoCodec ?? 'unknown',
                graceMs: hwdecGraceMs,
              });
            }
          } else {
            const message = `Hardware decode required but inactive (hwdec-current: ${status.hwdec ?? 'no'})`;
            if (message !== lastHwdecError) {
              lastHwdecError = message;
              if (enforceHwdec) {
                emitError(message);
              }
              logPreload(enforceHwdec ? 'warn' : 'info', 'hwdec enforcement', {
                enforced: enforceHwdec,
                hwdecCurrent: status.hwdec ?? 'no',
                allowSwDec,
                graceMs: hwdecGraceMs,
              });
            }
            if (enforceHwdec) {
              try {
                mpvNative?.stop?.();
              } catch (error) {
                logPreload('error', 'mpv stop failed', error);
              }
            }
          }
          hwdecDeadline = 0;
        }
        emitStatus(status as MpvStatus);
      }
      if (pendingLoad && Date.now() > pendingLoad.deadline) {
        logPreload('warn', 'mpv load timed out', { url: pendingLoad.url });
        settlePendingLoad({ error: 'Timed out waiting for mpv to load stream' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown libmpv error';
      emitError(message);
    }
  }, 250);
};

const mpvApi: MpvApi = useLibmpv
  ? {
    load: async (url: string) => {
      if (!ensureMpvNative()) return { error: 'libmpv not available' };
      if (!mpvNative?.isInitialized?.()) return { error: 'libmpv not initialized' };
      if (!mpvNative.load(url)) {
        const detail = mpvNative.getLastError?.();
        logPreload('error', 'mpv load failed', detail);
        return { error: detail ? `mpv load failed: ${detail}` : 'mpv load failed' };
      }
      lastMpvErrorLog = '';
      hwdecDeadline = 0;
      hwdecSatisfied = false;
      lastHwdecError = '';
      hwdecWarned = false;
      startStatusPolling();
      return await new Promise<MpvResult>((resolve) => {
        if (pendingLoad) {
          pendingLoad.resolve({ error: 'Load superseded by another request' });
        }
        pendingLoad = { resolve, deadline: Date.now() + 30000, url };
      });
    },
    play: async () => (mpvNative?.play?.()
      ? { success: true }
      : { error: mpvNative?.getLastError?.() ? `mpv play failed: ${mpvNative.getLastError()}` : 'mpv play failed' }),
    pause: async () => (mpvNative?.pause?.()
      ? { success: true }
      : { error: mpvNative?.getLastError?.() ? `mpv pause failed: ${mpvNative.getLastError()}` : 'mpv pause failed' }),
    togglePause: async () => (mpvNative?.togglePause?.()
      ? { success: true }
      : { error: mpvNative?.getLastError?.() ? `mpv toggle failed: ${mpvNative.getLastError()}` : 'mpv toggle failed' }),
    stop: async () => {
      hwdecDeadline = 0;
      hwdecSatisfied = false;
      lastHwdecError = '';
      return (mpvNative?.stop?.()
        ? { success: true }
        : { error: mpvNative?.getLastError?.() ? `mpv stop failed: ${mpvNative.getLastError()}` : 'mpv stop failed' });
    },
    setVolume: async (volume: number) => (mpvNative?.setVolume?.(volume)
      ? { success: true }
      : { error: mpvNative?.getLastError?.() ? `mpv volume failed: ${mpvNative.getLastError()}` : 'mpv volume failed' }),
    toggleMute: async () => (mpvNative?.toggleMute?.()
      ? { success: true }
      : { error: mpvNative?.getLastError?.() ? `mpv mute failed: ${mpvNative.getLastError()}` : 'mpv mute failed' }),
    seek: async (seconds: number) => (mpvNative?.seek?.(seconds)
      ? { success: true }
      : { error: mpvNative?.getLastError?.() ? `mpv seek failed: ${mpvNative.getLastError()}` : 'mpv seek failed' }),
    getStatus: async () => {
      if (!mpvNative?.getStatus) {
        return { playing: false, volume: 0, muted: false, position: 0, duration: 0 };
      }
      return mpvNative.getStatus() as MpvStatus;
    },
    initRenderer: () => null,
    setSize: () => null,
    renderFrame: () => false,
    attachCanvas: (canvasId: string) => {
      if (!ensureMpvNative()) {
        logPreload('error', 'libmpv not available');
        emitError('libmpv not available - install libmpv-dev');
        return false;
      }
      if (!mpvNative.isInitialized?.()) {
        logPreload('info', 'mpv init starting', { initialized: false });
        const ok = mpvNative.init?.();
        if (!ok) {
          const detail = mpvNative.getLastError?.();
          logPreload('error', 'libmpv init failed', detail);
          emitError(detail ? `libmpv init failed: ${detail}` : 'libmpv init failed');
          return false;
        }
        logPreload('info', 'mpv init ok');
      } else {
        logPreload('info', 'mpv already initialized');
      }
      const el = document.getElementById(canvasId);
      if (!(el instanceof HTMLCanvasElement)) {
        emitError(`attachCanvas: element #${canvasId} is not a canvas`);
        return false;
      }
      renderCanvas = el;
      renderCtx = el.getContext('2d', { alpha: false });
      if (!renderCtx) {
        emitError('attachCanvas: could not get 2D context');
        return false;
      }
      logPreload('info', 'attachCanvas', {
        canvasId,
        rect: renderCanvas.getBoundingClientRect(),
        dpr: window.devicePixelRatio || 1,
      });
      renderCanvas.style.width = '100%';
      renderCanvas.style.height = '100%';
      if (renderObserver) {
        renderObserver.disconnect();
        renderObserver = null;
      }
      renderObserver = new ResizeObserver(() => resizeFromCanvasRect());
      renderObserver.observe(renderCanvas);
      resizeFromCanvasRect();
      startStatusPolling();
      startRenderLoop();
      emitReady(true);
      return true;
    },
    isLibmpv: true,
    onReady: (callback: (ready: boolean) => void) => {
      readyListeners.add(callback);
      if (mpvReady) callback(true);
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
      if (mpvPollTimer) {
        clearInterval(mpvPollTimer);
        mpvPollTimer = null;
      }
      if (renderObserver) {
        renderObserver.disconnect();
        renderObserver = null;
      }
      stopRenderLoop();
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
    isLibmpv: false,
    onWarning: () => {
      // No-op on non-Linux fallback.
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

contextBridge.exposeInMainWorld('appConfig', {
  render: {
    fps: renderFps,
    maxWidth: renderMaxWidth,
    maxHeight: renderMaxHeight,
  },
  hwdec: {
    required: !allowSwDec && enforceHwdec,
    graceMs: hwdecGraceMs,
  },
});
