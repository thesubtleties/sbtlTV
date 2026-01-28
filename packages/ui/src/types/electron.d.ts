// Type declarations for APIs exposed by Electron preload script

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
  tmdbApiKey?: string;
  vodRefreshHours?: number;  // 0 = manual only, default 24
  epgRefreshHours?: number;  // 0 = manual only, default 6
  movieGenresEnabled?: number[];   // TMDB genre IDs to show as carousels
  seriesGenresEnabled?: number[];  // TMDB genre IDs for TV shows
  posterDbApiKey?: string;         // RatingPosterDB API key for rating posters
  rpdbBackdropsEnabled?: boolean;  // Use RPDB backdrops (requires tier 2+ key)
  allowLanSources?: boolean;       // Allow requests to LAN IPs (SSRF bypass)
}

export interface Source {
  id: string;
  name: string;
  type: 'xtream' | 'm3u' | 'epg';
  url: string;
  enabled: boolean;
  epg_url?: string;
  auto_load_epg?: boolean;
  username?: string;
  password?: string;
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

export interface PlatformApi {
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
}

declare global {
  interface Window {
    mpv?: MpvApi;
    electronWindow?: ElectronWindowApi;
    storage?: StorageApi;
    fetchProxy?: FetchProxyApi;
    platform?: PlatformApi;
  }
}

export {};
