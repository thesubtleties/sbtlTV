/**
 * report.json for Settings > Debug > Bug report (spec piece 3): what is needed to
 * look into a problem, and nothing that says who the user or their provider is.
 * Sources are "[source N]" (the debug log's labels; the Debug tab legend maps them
 * to names), secrets "set"/"not set", free text through `clean` (main passes the
 * log policy's always-labelling cleaner: hosts as labels, no logins, no home
 * folder). Pure: main gathers the inputs.
 */
import type { AppSettings } from './storage.js';

/** One source's sync state as the report uses it (times in ms). */
export interface SyncRow {
  source_id: string;
  /** Last channel or guide refresh (the page's data client merges the two) */
  last_synced?: number | null;
  last_vod_sync?: number | null;
  channel_count?: number | null; category_count?: number | null; movie_count?: number | null; series_count?: number | null;
  error?: string | null;
}

export interface ReportInputs {
  app: { version: string; build: { sha?: string; run?: string; ref?: string } | 'local' };
  system: {
    platform: string; arch: string; osVersion: string; electron: string; chrome: string; node: string;
    /** How sbtlTV was installed: AppImage, deb, dmg, installer, portable, dev… */
    install?: string;
    /** Linux: distribution and version (os-release ID + VERSION_ID), session type and desktop */
    distro?: string; session?: string; desktop?: string;
  };
  player: {
    mode: 'in-window' | 'external mpv'; why: string; error: string | null;
    hwdec: string; mpv: string; ffmpeg: string;
    /** Which GPU the in-window player matched (webgl / active / first / none) */
    gpuSelection?: string;
  };
  hardware: {
    cpu: string; threads: number; ramGB: number;
    gpus: { vendor?: string; device?: string; active?: boolean; renderer?: string; usedFor?: string; driver?: string; driverVersion?: string }[];
    /** How many displays, and the one sbtlTV's window is on (DIP size: CSS pixels) */
    displays: { count: number; window: { width: number; height: number; scale: number; hz: number | null } | null };
  };
  keyring: { backend: string | null; available: boolean; from: string };
  debugLoggingEnabled: boolean;
  addressesIncluded: boolean;
  settings: AppSettings | 'unreadable';
  sources: { id: string; type: string; enabled: boolean; epg_url?: string; auto_load_epg?: boolean; hasLogin: boolean }[] | 'unreadable';
  /** 'unavailable': the data process did not answer */
  syncStatus: SyncRow[] | 'unavailable';
}

/**
 * Every setting, and how the report shows it. Typed against AppSettings: a new
 * setting does not compile until it is classified here, so a future key or path
 * can never slip into a report unseen.
 */
const REPORT_SETTINGS = {
  theme: 'copy', lastSourceId: 'sourceId', tmdbApiKey: 'secret', vodRefreshHours: 'copy', epgRefreshHours: 'copy',
  movieGenresEnabled: 'copy', seriesGenresEnabled: 'copy', posterDbApiKey: 'secret', rpdbBackdropsEnabled: 'copy',
  allowLanSources: 'copy', debugLoggingEnabled: 'copy', channelSortOrder: 'copy', categorySortOrder: 'copy',
  autoUpdateEnabled: 'copy', betaUpdates: 'copy', categoryBarWidth: 'copy', channelColumnWidth: 'copy', guideOpacity: 'copy',
  liveSourceOrder: 'sourceIds', vodSourceOrder: 'sourceIds', sportsMatchupEnabled: 'copy', guideMorphEnabled: 'copy',
  autoplayNextEpisode: 'copy', linuxPlayerMode: 'copy', linuxPerformanceMode: 'copy', appearance: 'copy', subtitles: 'copy',
  rewindLiveBytes: 'copy', rewindTipShown: 'copy',
} as const satisfies Record<keyof AppSettings, 'copy' | 'secret' | 'sourceId' | 'sourceIds'>;

const iso = (ms: number | null | undefined): string | null => {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Every string inside a value through `clean`. */
function cleanDeep(value: unknown, clean: (text: string) => string): unknown {
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.map((v) => cleanDeep(v, clean));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanDeep(v, clean)]));
  return value;
}

/** Whether a source loads its provider's own guide (the same rule as the sync worker's syncGuide). */
export function loadsProviderGuide(s: { type: string; auto_load_epg?: boolean }): boolean {
  return s.auto_load_epg ?? s.type === 'xtream';
}

export function buildReport(inputs: ReportInputs, clean: (text: string) => string, createdAt: Date): Record<string, unknown> {
  const sources = inputs.sources === 'unreadable' ? [] : inputs.sources;
  const labelOf = new Map(sources.map((s, i) => [s.id, `[source ${i + 1}]`]));

  let settings: unknown = 'unreadable';
  if (inputs.settings !== 'unreadable') {
    const given = inputs.settings as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, how] of Object.entries(REPORT_SETTINGS)) {
      const value = given[key];
      if (how === 'secret') out[key] = value ? 'set' : 'not set';
      else if (how === 'sourceIds') out[key] = Array.isArray(value) ? value.flatMap((id) => (labelOf.has(id) ? [labelOf.get(id)] : [])) : null;
      else if (how === 'sourceId') out[key] = typeof value === 'string' ? (labelOf.get(value) ?? null) : null;
      else if (value !== undefined) out[key] = cleanDeep(value, clean);
    }
    settings = out;
  }

  const unavailable = inputs.syncStatus === 'unavailable';
  const metaOf = new Map((unavailable ? [] : (inputs.syncStatus as SyncRow[])).map((m) => [m.source_id, m]));
  const reportSources = inputs.sources === 'unreadable' ? 'unreadable' : sources.map((s, i) => {
    const m = metaOf.get(s.id);
    const count = (n: number | null | undefined) => (m ? (typeof n === 'number' && Number.isFinite(n) ? n : 0) : null);
    return {
      source: `[source ${i + 1}]`,
      type: s.type,
      enabled: s.enabled,
      login: s.hasLogin ? 'set' : 'not set',
      guide: loadsProviderGuide(s) ? 'provider' : s.epg_url ? 'own address' : 'none',
      sync: unavailable ? 'unavailable (the data process did not answer)' : m ? 'known' : 'never synced',
      lastSync: { channelsOrGuide: iso(m?.last_synced), library: iso(m?.last_vod_sync) },
      counts: { channels: count(m?.channel_count), categories: count(m?.category_count), movies: count(m?.movie_count), series: count(m?.series_count) },
      error: m?.error ? clean(m.error) : null,
    };
  });

  return {
    report: 'sbtltv-bug-report',
    version: 1,
    createdAt: createdAt.toISOString(),
    app: inputs.app,
    system: cleanDeep(inputs.system, clean),
    hardware: cleanDeep(inputs.hardware, clean),
    player: cleanDeep(inputs.player, clean),
    keyring: inputs.keyring,
    debugLoggingEnabled: inputs.debugLoggingEnabled,
    addressesIncluded: inputs.addressesIncluded,
    settings,
    sources: reportSources,
  };
}

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.getTime();
  return undefined;
};

/**
 * The sync status as the page sent it: the page's data client shape (SourceMetaRow:
 * last_synced / vod_last_synced as Dates, vod_movie_count, vod_series_count), or the
 * data process's columns. Known fields of the right type only, at most 500 rows;
 * not a list: 'unavailable' (the page's query failed).
 */
export function validateSyncStatus(raw: unknown): ReportInputs['syncStatus'] {
  if (!Array.isArray(raw)) return 'unavailable';
  return raw.slice(0, 500).flatMap((row): SyncRow[] => {
    if (!row || typeof row !== 'object' || typeof (row as { source_id?: unknown }).source_id !== 'string') return [];
    const r = row as Record<string, unknown>;
    const out: Record<string, unknown> = { source_id: (r.source_id as string).slice(0, 200) };
    const pick = (key: string, ...from: string[]) => {
      for (const f of from) { const v = num(r[f]); if (v !== undefined) { out[key] = v; return; } }
    };
    pick('last_synced', 'last_synced', 'last_epg_sync', 'last_channel_sync');
    pick('last_vod_sync', 'vod_last_synced', 'last_vod_sync');
    pick('channel_count', 'channel_count');
    pick('category_count', 'category_count');
    pick('movie_count', 'vod_movie_count', 'movie_count');
    pick('series_count', 'vod_series_count', 'series_count');
    if (typeof r.error === 'string') out.error = r.error.slice(0, 2000);
    return [out as unknown as SyncRow];
  });
}

// The log policy's own lines (log-policy.ts) and the session header (main.ts): where
// "Provider addresses in the debug log" was switched on and off.
const ADDRESSES_ON = ['Provider addresses are included in this log from here on', 'Provider addresses: included'];
const ADDRESSES_OFF = ['Provider addresses are replaced by labels again', 'Provider addresses: replaced by labels'];
const SESSION_START = 'Debug logging started';
const isOn = (line: string) => ADDRESSES_ON.some((m) => line.includes(m));
const isOff = (line: string) => ADDRESSES_OFF.some((m) => line.includes(m));

/**
 * A log as it goes into the report zip: its last `maxBytes` (starting at a whole
 * line), every line through `clean` again, and every line written while provider
 * addresses were included left out (a bare host there can't be recognised later),
 * with a note of how many. Markers: the switch's own lines and each session header's
 * "Provider addresses: …" line. Before the first marker in the kept part the state is
 * unknown: the opposite of that marker, or, with no marker at all, `includedWithoutMarker`
 * (main passes the switch's current state for the current log, true for the previous
 * one). It fails closed: when in doubt, the lines are left out.
 */
export function reportLogText(raw: Buffer, maxBytes: number, clean: (line: string) => string, includedWithoutMarker = true): string {
  let text = raw.toString('utf8');
  if (raw.length > maxBytes) {
    text = raw.subarray(raw.length - maxBytes).toString('utf8');
    const firstBreak = text.indexOf('\n');
    text = firstBreak === -1 ? '' : text.slice(firstBreak + 1);
  }
  const lines = text.split('\n');
  const firstMarker = lines.find((l) => isOn(l) || isOff(l));
  let included = firstMarker === undefined ? includedWithoutMarker : isOff(firstMarker);
  let leftOut = 0;
  const out: string[] = [];
  const note = () => {
    if (leftOut > 0) out.push(`… ${leftOut} line${leftOut === 1 ? '' : 's'} left out: written while provider addresses were included`);
    leftOut = 0;
  };
  for (const line of lines) {
    if (included) {
      // A session header resets the switch (it is never saved); its next line says which way.
      if (isOff(line) || line.includes(SESSION_START)) { included = false; note(); }
      else { if (line) leftOut++; continue; }
    }
    out.push(line ? clean(line) : line);
    if (isOn(line)) included = true;
  }
  note();
  return out.join('\n');
}
