// Type declarations for APIs exposed by Electron preload script

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
  mute: (mute: boolean) => Promise<MpvResult>;
  seek: (seconds: number) => Promise<MpvResult>;
  getStatus: () => Promise<MpvStatus>;
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

export interface Source {
  id: string;
  name: string;
  type: 'xtream' | 'm3u' | 'epg';
  url: string;
  enabled: boolean;
  epg_url?: string;
  username?: string;
  password?: string;
}

export interface StorageApi {
  getSources: () => Promise<StorageResult<Source[]>>;
  getSource: (id: string) => Promise<StorageResult<Source | undefined>>;
  saveSource: (source: Source) => Promise<StorageResult>;
  deleteSource: (id: string) => Promise<StorageResult>;
  getSettings: () => Promise<StorageResult<AppSettings>>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<StorageResult>;
  isEncryptionAvailable: () => Promise<StorageResult<boolean>>;
}

export interface FetchProxyResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
}

export interface FetchProxyApi {
  fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<StorageResult<FetchProxyResponse>>;
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
