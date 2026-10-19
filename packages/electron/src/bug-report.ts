/**
 * report.json for Settings > Debug > Bug report (spec piece 3): what is needed to
 * look into a problem, and nothing that says who the user or their provider is.
 * Sources are "[source N]" (the debug log's labels; the Debug tab legend maps them
 * to names), secrets "set"/"not set", free text through the log policy (`clean`:
 * labels for hosts, logins removed). Pure: main gathers the inputs.
 */
import type { AppSettings } from './storage.js';

export interface ReportInputs {
  app: { version: string; build: { sha?: string; run?: string; ref?: string } | 'local' };
  system: { platform: string; arch: string; osVersion: string; electron: string; chrome: string; node: string };
  player: { mode: 'native' | 'compatibility'; why: string; error: string | null; hwdec: string; mpv: string; ffmpeg: string };
  hardware: {
    cpu: string; threads: number; ramGB: number; freeRamGB: number;
    gpus: { renderer?: string; vendor?: string; driver?: string; driverVersion?: string; gl?: string; active?: boolean }[];
    displays: { width: number; height: number; scale: number; hz: number }[];
  };
  keyring: { backend: string | null; available: boolean; from: string };
  debugLoggingEnabled: boolean;
  addressesIncluded: boolean;
  settings: AppSettings | 'unreadable';
  sources: { id: string; type: string; enabled: boolean; epg_url?: string; auto_load_epg?: boolean; hasLogin: boolean }[] | 'unreadable';
  syncStatus: {
    source_id: string;
    last_channel_sync?: number | null; last_epg_sync?: number | null; last_vod_sync?: number | null;
    channel_count?: number | null; category_count?: number | null; movie_count?: number | null; series_count?: number | null;
    error?: string | null;
  }[];
}

export const SECRET_SETTINGS = ['tmdbApiKey', 'posterDbApiKey'] as const;
const SOURCE_ID_LISTS = ['liveSourceOrder', 'vodSourceOrder'] as const;

const iso = (ms: number | null | undefined) => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** Every string inside a value through `clean` (labels for hosts, no logins). */
function cleanDeep(value: unknown, clean: (text: string) => string): unknown {
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.map((v) => cleanDeep(v, clean));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanDeep(v, clean)]));
  return value;
}

export function buildReport(inputs: ReportInputs, clean: (text: string) => string, createdAt: Date): Record<string, unknown> {
  const sources = inputs.sources === 'unreadable' ? [] : inputs.sources;
  const labelOf = new Map(sources.map((s, i) => [s.id, `[source ${i + 1}]`]));

  let settings: unknown = 'unreadable';
  if (inputs.settings !== 'unreadable') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(inputs.settings)) {
      if ((SECRET_SETTINGS as readonly string[]).includes(key)) continue;
      if ((SOURCE_ID_LISTS as readonly string[]).includes(key)) {
        out[key] = Array.isArray(value) ? value.flatMap((id) => (labelOf.has(id) ? [labelOf.get(id)] : [])) : value;
      } else if (key === 'lastSourceId') {
        out[key] = typeof value === 'string' ? (labelOf.get(value) ?? null) : null;
      } else {
        out[key] = cleanDeep(value, clean);
      }
    }
    for (const key of SECRET_SETTINGS) out[key] = inputs.settings[key] ? 'set' : 'not set';
    settings = out;
  }

  const metaOf = new Map(inputs.syncStatus.map((m) => [m.source_id, m]));
  const reportSources = inputs.sources === 'unreadable' ? 'unreadable' : sources.map((s, i) => {
    const m = metaOf.get(s.id);
    const loadsOwnGuide = s.auto_load_epg ?? s.type === 'xtream';
    return {
      source: `[source ${i + 1}]`,
      type: s.type,
      enabled: s.enabled,
      login: s.hasLogin ? 'set' : 'not set',
      guide: loadsOwnGuide ? 'provider' : s.epg_url ? 'own address' : 'none',
      lastSync: { channels: iso(m?.last_channel_sync), guide: iso(m?.last_epg_sync), library: iso(m?.last_vod_sync) },
      counts: { channels: m?.channel_count ?? 0, categories: m?.category_count ?? 0, movies: m?.movie_count ?? 0, series: m?.series_count ?? 0 },
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
    player: { ...(cleanDeep(inputs.player, clean) as object), error: inputs.player.error ? clean(inputs.player.error) : null },
    keyring: inputs.keyring,
    debugLoggingEnabled: inputs.debugLoggingEnabled,
    addressesIncluded: inputs.addressesIncluded,
    settings,
    sources: reportSources,
  };
}
