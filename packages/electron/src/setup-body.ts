/**
 * What a setup file holds, checked strictly before an import changes anything,
 * and which settings travel between computers. Pure (type-only imports).
 */
import type { AppSettings } from './storage.js';

export type SetupPart = 'sources' | 'logins' | 'settings' | 'apiKeys' | 'favorites' | 'watchlist' | 'progress';
const PARTS: readonly SetupPart[] = ['sources', 'logins', 'settings', 'apiKeys', 'favorites', 'watchlist', 'progress'];

export interface SetupSource {
  id: string; name: string; type: 'xtream' | 'm3u' | 'epg'; url: string;
  username?: string; password?: string; epg_url?: string; auto_load_epg?: boolean; enabled: boolean;
  /** File-based M3U only (url "imported:<name>"): the playlist rebuilt from its channels */
  playlist?: string;
}
export interface UserLists { favorites?: unknown[]; watchlist?: unknown[]; progress?: unknown[]; lastCategory?: string }
export interface SetupBody {
  app: string; exportedAt: string; platform: string; includes: SetupPart[];
  sources?: SetupSource[]; settings?: Partial<AppSettings>; apiKeys?: { tmdb?: string; posterDb?: string }; lists?: UserLists;
}
export interface SetupPreview {
  app: string; exportedAt: string; platform: string;
  sources: { name: string; type: string; withLogin: boolean; fromFile: boolean }[];
  settings: boolean; apiKeys: boolean; favorites: number; watchlist: number; progress: number;
}

/** Settings that are about the person, not the computer: these travel. */
export const SETUP_SETTING_KEYS = [
  'theme', 'lastSourceId', 'vodRefreshHours', 'epgRefreshHours', 'movieGenresEnabled', 'seriesGenresEnabled',
  'rpdbBackdropsEnabled', 'allowLanSources', 'channelSortOrder', 'categorySortOrder', 'categoryBarWidth',
  'channelColumnWidth', 'guideOpacity', 'liveSourceOrder', 'vodSourceOrder', 'sportsMatchupEnabled',
  'guideMorphEnabled', 'autoplayNextEpisode', 'appearance', 'subtitles',
] as const satisfies readonly (keyof AppSettings)[];
const SETTING_KEYS = new Set<string>(SETUP_SETTING_KEYS);
const SECRET_STORED_KEYS = new Set(['encryptedTmdbApiKey', 'encryptedPosterDbApiKey']);

const MAX_SOURCES = 200;
const MAX_PLAYLIST = 64 * 1024 * 1024;
const MAX_LIST = 200_000;
const MAX_TEXT = 2000;

function fail(what: string): never { throw new Error(`invalid: ${what}`); }
function isObj(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function only(o: Record<string, unknown>, allowed: readonly string[], what: string) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${what}.${k}`);
}
function text(v: unknown, what: string, max = MAX_TEXT): string {
  if (typeof v !== 'string' || v.length > max) fail(what);
  return v;
}
function webUrl(v: unknown, what: string): string {
  const s = text(v, what);
  let u: URL;
  try { u = new URL(s); } catch { fail(what); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') fail(what);
  return s;
}

function validateSource(raw: unknown, i: number): SetupSource {
  const w = `sources[${i}]`;
  if (!isObj(raw)) fail(w);
  only(raw, ['id', 'name', 'type', 'url', 'username', 'password', 'epg_url', 'auto_load_epg', 'enabled', 'playlist'], w);
  const type = raw.type;
  if (type !== 'xtream' && type !== 'm3u' && type !== 'epg') fail(`${w}.type`);
  const id = text(raw.id, `${w}.id`, 200);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) fail(`${w}.id`);
  const url = text(raw.url, `${w}.url`);
  const fromFile = type === 'm3u' && url.startsWith('imported:');
  if (!fromFile) webUrl(url, `${w}.url`);
  if (raw.playlist !== undefined && (!fromFile || typeof raw.playlist !== 'string' || raw.playlist.length > MAX_PLAYLIST)) fail(`${w}.playlist`);
  if (raw.epg_url !== undefined && raw.epg_url !== '') webUrl(raw.epg_url, `${w}.epg_url`);
  if (typeof raw.enabled !== 'boolean') fail(`${w}.enabled`);
  if (raw.auto_load_epg !== undefined && typeof raw.auto_load_epg !== 'boolean') fail(`${w}.auto_load_epg`);
  return {
    id, name: text(raw.name, `${w}.name`), type, url, enabled: raw.enabled,
    ...(raw.username !== undefined && { username: text(raw.username, `${w}.username`) }),
    ...(raw.password !== undefined && { password: text(raw.password, `${w}.password`) }),
    ...(raw.epg_url !== undefined && { epg_url: raw.epg_url as string }),
    ...(raw.auto_load_epg !== undefined && { auto_load_epg: raw.auto_load_epg as boolean }),
    ...(raw.playlist !== undefined && { playlist: raw.playlist as string }),
  };
}

function validateSettings(raw: unknown): Partial<AppSettings> {
  if (!isObj(raw)) fail('settings');
  for (const [k, v] of Object.entries(raw)) {
    if (!SETTING_KEYS.has(k)) fail(`settings.${k}`);
    // Shapes only; storage.updateSettings + getSettings normalise the values.
    const ok = v === undefined || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string'
      || (Array.isArray(v) && v.length <= 1000 && v.every((x) => typeof x === 'string' || typeof x === 'number'))
      || (isObj(v) && JSON.stringify(v).length <= 10_000);
    if (!ok) fail(`settings.${k}`);
  }
  return raw as Partial<AppSettings>;
}

function validateList(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v) || v.length > MAX_LIST) fail(what);
  return v;
}

export function validateSetupBody(raw: unknown): SetupBody {
  if (!isObj(raw)) fail('body');
  only(raw, ['app', 'exportedAt', 'platform', 'includes', 'sources', 'settings', 'apiKeys', 'lists'], 'body');
  const includes = raw.includes;
  if (!Array.isArray(includes) || !includes.every((p) => PARTS.includes(p as SetupPart))) fail('includes');
  const body: SetupBody = { app: text(raw.app, 'app', 50), exportedAt: text(raw.exportedAt, 'exportedAt', 50), platform: text(raw.platform, 'platform', 50), includes: includes as SetupPart[] };
  if (raw.sources !== undefined) {
    if (!Array.isArray(raw.sources) || raw.sources.length > MAX_SOURCES) fail('sources');
    body.sources = raw.sources.map(validateSource);
    if (new Set(body.sources.map((s) => s.id)).size !== body.sources.length) fail('sources: duplicate id');
  }
  if (raw.settings !== undefined) body.settings = validateSettings(raw.settings);
  if (raw.apiKeys !== undefined) {
    if (!isObj(raw.apiKeys)) fail('apiKeys');
    only(raw.apiKeys, ['tmdb', 'posterDb'], 'apiKeys');
    body.apiKeys = {
      ...(raw.apiKeys.tmdb !== undefined && { tmdb: text(raw.apiKeys.tmdb, 'apiKeys.tmdb', 500) }),
      ...(raw.apiKeys.posterDb !== undefined && { posterDb: text(raw.apiKeys.posterDb, 'apiKeys.posterDb', 500) }),
    };
  }
  if (raw.lists !== undefined) {
    if (!isObj(raw.lists)) fail('lists');
    only(raw.lists, ['favorites', 'watchlist', 'progress', 'lastCategory'], 'lists');
    body.lists = {
      ...(raw.lists.favorites !== undefined && { favorites: validateList(raw.lists.favorites, 'lists.favorites') }),
      ...(raw.lists.watchlist !== undefined && { watchlist: validateList(raw.lists.watchlist, 'lists.watchlist') }),
      ...(raw.lists.progress !== undefined && { progress: validateList(raw.lists.progress, 'lists.progress') }),
      ...(raw.lists.lastCategory !== undefined && { lastCategory: text(raw.lists.lastCategory, 'lists.lastCategory', 500) }),
    };
  }
  return body;
}

export function settingsForExport(s: AppSettings): Partial<AppSettings> {
  const out: Record<string, unknown> = {};
  for (const k of SETUP_SETTING_KEYS) if (s[k] !== undefined) out[k] = s[k];
  return out as Partial<AppSettings>;
}

/** Stored settings an import leaves alone: everything that does not travel and is not a secret. */
export function keptOnImport<T extends Record<string, unknown>>(stored: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stored)) if (!SETTING_KEYS.has(k) && !SECRET_STORED_KEYS.has(k)) out[k] = v;
  return out as Partial<T>;
}

export function describeSetup(body: SetupBody): SetupPreview {
  return {
    app: body.app, exportedAt: body.exportedAt, platform: body.platform,
    sources: (body.sources ?? []).map((s) => ({ name: s.name, type: s.type, withLogin: !!s.password, fromFile: s.url.startsWith('imported:') })),
    settings: body.settings !== undefined,
    apiKeys: !!(body.apiKeys?.tmdb || body.apiKeys?.posterDb),
    favorites: body.lists?.favorites?.length ?? 0,
    watchlist: body.lists?.watchlist?.length ?? 0,
    progress: body.lists?.progress?.length ?? 0,
  };
}
