// Type declarations for APIs exposed by Electron preload script

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

export type StreamRecoveryUpdate =
  | { state: 'reconnecting'; attempt: number }
  | { state: 'failed'; live: boolean };

/**
 * Main starts a load: every one is announced, whoever started it (play: the
 * renderer's request, reload: the stall watchdog, restore: the compatibility
 * restart). Subtitles and progress saving follow the announced generation.
 */
/** Live with rewind on: what can be reached, sent by main once a second */
export interface RewindStateUpdate {
  generation: number;
  /** Oldest reachable stream time (s) */
  rangeStart: number;
  /** Live edge, stream time (s) */
  liveEdge: number;
  /** Measured input rate, bytes per second */
  bytesPerSecond: number;
}

export interface MediaLoadedUpdate {
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

export interface SubtitleTrack {
  id: number;
  lang: string | null;
  title: string | null;
  codec: string;
  /** EIA-608 closed captions carried in the video (live TV) */
  isCc: boolean;
}

export interface SubtitleTracksUpdate {
  /** main's load counter; a new value means a new load (a stall reload of the same stream included) */
  generation: number;
  tracks: SubtitleTrack[];
  /** The file's duration when main knows it for this load, else 0 */
  duration: number;
}

/** Live captions: main checks the first lines and hides station-data junk */
export type CcState = 'checking' | 'ok' | 'other-language' | 'unreadable';

export interface SubtitlesApi {
  /** Calls carry the load generation they were decided for; main ignores stale ones. null turns subtitles off. */
  setTrack: (generation: number, id: number | null, visible: boolean) => Promise<MpvResult>;
  /** Show or hide without restarting the decoder (live captions keep decoding) */
  setVisible: (generation: number, visible: boolean) => Promise<MpvResult>;
  setDelay: (generation: number, seconds: number) => Promise<MpvResult>;
  /** Returns an unsubscribe function */
  onTracks: (callback: (update: SubtitleTracksUpdate) => void) => () => void;
  /** language: set for other-language, the only caption language the channel gave */
  onCcState: (callback: (update: { generation: number; state: CcState; language: 'en' | 'es' | 'fr' | null }) => void) => () => void;
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

export type PaletteId = 'sbtl' | 'sbtl-light' | 'mocha' | 'pi' | 'catppuccin' | 'tokyonight' | 'kanagawa' | 'gruvbox' | 'nord' | 'rosepine' | 'everforest' | 'dracula' | 'caelestia';
export type Typeface = 'fira' | 'mono' | 'system';
export interface Appearance {
  palette: PaletteId;
  typeface: Typeface;
  accent: 'palette' | 'system';  // 'system' takes the OS accent where there is one
}

/** Colors the desktop provides (Settings > Appearance). */
export interface DesktopColors {
  accent: string | null;
  caelestia: import('../styles/palettes').PaletteRoles | null;
}

/** Settings > Privacy: what IP outside services see (asks Mullvad's checker, only when called) */
export interface IpCheckResult {
  ip: string;
  city: string | null;
  country: string | null;
  /** Who owns the address: an ISP, or a VPN's hosting company */
  organization: string | null;
  /** The Mullvad server the connection leaves from, when it is a Mullvad exit */
  mullvadServer: string | null;
}

/** How saved passwords and API keys are protected on this computer */
export interface StorageProtection {
  platform: string;
  /** The system offers encryption (on Linux this includes Chromium's 'basic_text' fallback) */
  available: boolean;
  /** Linux: 'kwallet', 'kwallet5', 'kwallet6', 'gnome_libsecret', 'basic_text' or 'unknown'; null elsewhere */
  backend: string | null;
  /** Linux: the keyring a --password-store at launch forces (it wins over the setting); null otherwise */
  launchKeyring: string | null;
}

export type SetupPart = 'sources' | 'logins' | 'settings' | 'apiKeys' | 'favorites' | 'watchlist' | 'progress';
export interface SetupPreview {
  app: string; exportedAt: string; platform: string;
  sources: { name: string; type: string; withLogin: boolean; fromFile: boolean; host: string | null }[];
  settings: boolean; apiKeys: boolean; favorites: number; watchlist: number; progress: number;
}
export interface SetupListsWire { favorites?: unknown[]; watchlist?: unknown[]; progress?: unknown[]; lastCategory?: string }
type SetupResult<T> = { success: true; data: T } | { success: false; canceled: true } | { success?: undefined; error: string };
export interface SetupApi {
  exportSetup: (req: { parts: SetupPart[]; lists: SetupListsWire; playlists: Record<string, string> }) => Promise<SetupResult<{ passphrase: string; filePath: string }>>;
  pick: () => Promise<SetupResult<{ token: string; needsPassphrase: boolean }>>;
  unlock: (token: string, passphrase: string) => Promise<SetupResult<SetupPreview>>;
  backups: () => Promise<{ success: true; data: { name: string; label: string }[] }>;
  openBackup: (name: string) => Promise<SetupResult<{ token: string; preview: SetupPreview }>>;
  apply: (token: string, opts: { backupFirst: boolean; currentLists: SetupListsWire; currentPlaylists: Record<string, string> }) => Promise<SetupResult<{ lists: SetupListsWire; backupName: string | null }> | { error: string; backupName: string | null }>;
  relaunch: () => Promise<void>;
  showFile: () => Promise<void>;
  pendingPlaylists: () => Promise<{ sourceId: string; content: string }[]>;
  settlePlaylists: (sourceIds: string[]) => Promise<void>;
}

export interface PrivacyApi {
  checkIp: () => Promise<{ success?: boolean; data?: IpCheckResult; error?: string }>;
  storageProtection: () => Promise<StorageProtection>;
  /** Linux: drop saved passwords and API keys, keep this keyring, and restart */
  switchKeyring: (keyring: string) => Promise<{ success?: boolean; error?: string }>;
}

export interface AppearanceApi {
  getDesktopColors: () => Promise<DesktopColors>;
  onDesktopColorsChanged: (callback: (colors: DesktopColors) => void) => () => void;
}

export interface SubtitleSettings {
  liveDefault: boolean;
  vodDefault: boolean;
  size: 'small' | 'medium' | 'large';
  style: 'outline' | 'box' | 'shadow';
  /** 'auto' = the system language, else a subtitle language code (en, pt-br, ...) */
  language: string;
  /** Downloaded subtitles: SDH (sound cues) over standard */
  preferSdh?: boolean;
}

export interface AppSettings {
  theme: 'dark' | 'light';
  appearance?: Appearance;  // Palette and typeface (default sbtl / fira)
  lastSourceId?: string;
  tmdbApiKey?: string;
  vodRefreshHours?: number;  // 0 = manual only, default 24
  epgRefreshHours?: number;  // 0 = manual only, default 6
  movieGenresEnabled?: number[];   // TMDB genre IDs to show as carousels
  seriesGenresEnabled?: number[];  // TMDB genre IDs for TV shows
  posterDbApiKey?: string;         // RatingPosterDB API key for rating posters
  subdlApiKey?: string;            // SubDL API key for downloaded subtitles
  rpdbBackdropsEnabled?: boolean;  // Use RPDB backdrops (requires tier 2+ key)
  allowLanSources?: boolean;       // Allow requests to LAN IPs (SSRF bypass)
  debugLoggingEnabled?: boolean;   // Write verbose logs to file for debugging
  channelSortOrder?: 'alphabetical' | 'number';  // Channel list ordering
  categorySortOrder?: 'alphabetical' | 'provider';  // Live category strip ordering (default: alphabetical)
  autoUpdateEnabled?: boolean;  // Auto-check for updates on launch (default true)
  betaUpdates?: boolean;        // Offer beta (pre-release) updates too (default false)
  categoryBarWidth?: number;    // Category strip content width in px (default 160)
  channelColumnWidth?: number;  // Guide channel-info column width in px (default 300, clamped 220-520)
  guideOpacity?: number;        // Background opacity for EPG/category/title bar (default 0.95)
  liveSourceOrder?: string[];   // Source IDs in priority order for live TV
  vodSourceOrder?: string[];    // Source IDs in priority order for VOD (Xtream only)
  sportsMatchupEnabled?: boolean;  // Show team logos in the bar on a live sports game (default off: the logos load from ESPN)
  guideMorphEnabled?: boolean;     // Animate guide rows into place after a noticeable wait (default true)
  autoplayNextEpisode?: boolean;  // Autoplay next episode for series (default true)
  linuxPlayerMode?: 'native' | 'compatibility';  // Linux only: player used at next launch (default native)
  linuxPerformanceMode?: boolean;  // Linux only: cheaper mpv rendering (next launch) and no blur over video
  subtitles?: SubtitleSettings;  // Caption defaults (live / movies & series) and subtitle look
  rewindLiveBytes?: number;  // Rewind live TV: in-memory back buffer per live channel, bytes; 0/absent = Off
  rewindTipShown?: boolean;  // The one-time "turn on rewind" tip has been shown
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
  isDev: boolean;
  isPortable: boolean;
  isLinuxNonAppImage: boolean;
  supportsAutoUpdate: boolean;
  getVersion: () => Promise<string>;
  /** The largest Rewind live TV size this computer allows, in bytes (0 = not enough memory) */
  rewindCapBytes: () => Promise<number>;
}

export interface DebugApi {
  getLogPath: () => Promise<StorageResult<string>>;
  logFromRenderer: (message: string) => Promise<StorageResult>;
  /** Settings > Debug > Bug report: the report.json that would be saved */
  reportPreview: (syncStatus: unknown) => Promise<{ success?: boolean; data?: string; error?: string }>;
  /** Save the bug report zip (save dialog); shows it in its folder */
  saveReport: (syncStatus: unknown) => Promise<{ success?: boolean; canceled?: boolean; data?: { filePath: string }; error?: string }>;
  openLogFolder: () => Promise<StorageResult>;
  isEnabled?: () => Promise<boolean>;
  onEnabledChanged?: (callback: (enabled: boolean) => void) => () => void;
  getIncludeAddresses?: () => Promise<boolean>;
  setIncludeAddresses?: (on: boolean) => Promise<boolean>;
  getSourceLegend?: () => Promise<{ n: number; name: string }[]>;
}

export interface UpdateInfo {
  version: string;
  releaseDate: string;
}

export interface DownloadProgress {
  percent: number;
}

export interface UpdateError {
  message: string;
}

export interface UpdaterApi {
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => void;
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => void;
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => void;
  onError: (callback: (error: UpdateError) => void) => void;
  checkForUpdates: () => Promise<StorageResult<UpdateInfo | null>>;
  installUpdate: () => Promise<StorageResult>;
  removeAllListeners: () => void;
}

export interface SharedTextureApi {
  /** Register callback to receive VideoFrames from native mpv */
  onFrame: (callback: (videoFrame: VideoFrame, index: number) => void) => void;
  /** Remove the frame callback */
  removeFrameListener: () => void;
  /** Register callback for canvas clear on content switch */
  onClear: (callback: () => void) => void;
  /** Remove the clear callback */
  removeClearListener: () => void;
  /** Report whether the renderer could draw the latest frame; errors escalate in main */
  reportDrawResult: (ok: boolean, message?: string) => void;
  /** Linux frame pacing: how far (ms) the shown picture trails frame arrival */
  reportPresentationDelay?: (delayMs: number) => void;
  /** Report a renderer failure that requires native playback recovery. */
  reportPipelineFailure: (message: string) => void;
  /** Whether sharedTexture API is available (native mpv mode) */
  isAvailable: boolean;
}

declare global {
  interface DataApi {
    requestPort(): void;
  }

  interface Window {
    data?: DataApi;
    mpv?: MpvApi;
    subtitles?: SubtitlesApi;
    electronWindow?: ElectronWindowApi;
    storage?: StorageApi;
    appearance?: AppearanceApi;
    privacy?: PrivacyApi;
    setup?: SetupApi;
    fetchProxy?: FetchProxyApi;
    platform?: PlatformApi;
    debug?: DebugApi;
    updater?: UpdaterApi;
    sharedTexture?: SharedTextureApi;
  }
}

export {};
