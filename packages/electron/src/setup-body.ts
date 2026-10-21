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
  sources?: SetupSource[]; settings?: Partial<AppSettings>; apiKeys?: { tmdb?: string; posterDb?: string; subdl?: string }; lists?: UserLists;
}
export interface SetupPreview {
  app: string; exportedAt: string; platform: string;
  sources: { name: string; type: string; withLogin: boolean; fromFile: boolean; host: string | null }[];
  settings: boolean; apiKeys: boolean; favorites: number; watchlist: number; progress: number;
}

/**
 * Settings that are about the person, not the computer: these travel. Not
 * allowLanSources: it lowers the guard on what sources may reach, and a file from
 * someone else must not be able to turn that on.
 */
export const SETUP_SETTING_KEYS = [
  'theme', 'lastSourceId', 'vodRefreshHours', 'epgRefreshHours', 'movieGenresEnabled', 'seriesGenresEnabled',
  'rpdbBackdropsEnabled', 'channelSortOrder', 'categorySortOrder', 'categoryBarWidth',
  'channelColumnWidth', 'guideOpacity', 'liveSourceOrder', 'vodSourceOrder', 'sportsMatchupEnabled',
  'guideMorphEnabled', 'autoplayNextEpisode', 'appearance', 'subtitles',
] as const satisfies readonly (keyof AppSettings)[];
const SETTING_KEYS = new Set<string>(SETUP_SETTING_KEYS);
const SECRET_STORED_KEYS = new Set(['encryptedTmdbApiKey', 'encryptedPosterDbApiKey', 'encryptedSubdlApiKey']);

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

// Each setting that travels, with the values the app can live with: a file from
// someone else must not be able to store a value the app breaks on at start.
type Check = (v: unknown) => boolean;
const oneOf = (...values: string[]): Check => (v) => typeof v === 'string' && values.includes(v);
const bool: Check = (v) => typeof v === 'boolean';
const num = (min: number, max: number): Check => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const shortText: Check = (v) => typeof v === 'string' && v.length <= 200;
const list = (item: Check): Check => (v) => Array.isArray(v) && v.length <= 1000 && v.every(item);
const record: Check = (v) => isObj(v) && JSON.stringify(v).length <= 10_000;  // normalised by getSettings
const SETTING_CHECKS: Record<(typeof SETUP_SETTING_KEYS)[number], Check> = {
  theme: oneOf('dark', 'light'),
  lastSourceId: shortText,
  vodRefreshHours: num(0, 24 * 365),
  epgRefreshHours: num(0, 24 * 365),
  movieGenresEnabled: list((v) => Number.isInteger(v)),
  seriesGenresEnabled: list((v) => Number.isInteger(v)),
  rpdbBackdropsEnabled: bool,
  channelSortOrder: oneOf('alphabetical', 'number'),
  categorySortOrder: oneOf('alphabetical', 'provider'),
  categoryBarWidth: num(0, 4000),
  channelColumnWidth: num(0, 4000),
  guideOpacity: num(0, 1),
  liveSourceOrder: list(shortText),
  vodSourceOrder: list(shortText),
  sportsMatchupEnabled: bool,
  guideMorphEnabled: bool,
  autoplayNextEpisode: bool,
  appearance: record,
  subtitles: record,
};

function validateSettings(raw: unknown): Partial<AppSettings> {
  if (!isObj(raw)) fail('settings');
  for (const [k, v] of Object.entries(raw)) {
    if (!SETTING_KEYS.has(k)) fail(`settings.${k}`);
    if (v !== undefined && !SETTING_CHECKS[k as keyof typeof SETTING_CHECKS](v)) fail(`settings.${k}`);
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
    only(raw.apiKeys, ['tmdb', 'posterDb', 'subdl'], 'apiKeys');
    body.apiKeys = {
      ...(raw.apiKeys.tmdb !== undefined && { tmdb: text(raw.apiKeys.tmdb, 'apiKeys.tmdb', 500) }),
      ...(raw.apiKeys.posterDb !== undefined && { posterDb: text(raw.apiKeys.posterDb, 'apiKeys.posterDb', 500) }),
      ...(raw.apiKeys.subdl !== undefined && { subdl: text(raw.apiKeys.subdl, 'apiKeys.subdl', 500) }),
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

/** Where a source connects, for the preview: the hostname only (no port, path, query or login). */
function hostOf(url: string): string | null {
  try { return new URL(url).hostname || null; } catch { return null; }
}

export function describeSetup(body: SetupBody): SetupPreview {
  return {
    app: body.app, exportedAt: body.exportedAt, platform: body.platform,
    sources: (body.sources ?? []).map((s) => ({ name: s.name, type: s.type, withLogin: !!s.password, fromFile: s.url.startsWith('imported:'), host: hostOf(s.url) })),
    settings: body.settings !== undefined,
    apiKeys: !!(body.apiKeys?.tmdb || body.apiKeys?.posterDb || body.apiKeys?.subdl),
    favorites: body.lists?.favorites?.length ?? 0,
    watchlist: body.lists?.watchlist?.length ?? 0,
    progress: body.lists?.progress?.length ?? 0,
  };
}

const LIST_NAMES: Record<string, string> = { favorites: 'favorites', watchlist: 'watchlist', progress: 'watch progress' };

/**
 * Why this computer's own setup can't be exported, from validateSetupBody's
 * message: which source and what, in words (the stored data broke a rule a file
 * must follow, e.g. a source address that isn't http(s)).
 */
export function explainExportProblem(message: string, sources: { name: string }[]): string {
  const source = /^invalid: sources\[(\d+)\]\.(\w+)/.exec(message);
  if (source) {
    const name = sources[Number(source[1])]?.name ?? 'A source';
    const field = source[2];
    const why = field === 'url' ? 'its address has to start with http:// or https://'
      : field === 'epg_url' ? 'its guide address has to start with http:// or https://'
      : field === 'playlist' ? 'its playlist is too large'
      : 'one of its details is too long';
    return `${name} can't be exported: ${why}.`;
  }
  const setting = /^invalid: settings\.(\w+)/.exec(message);
  if (setting) return `A setting has a value sbtlTV can't export (${setting[1]}).`;
  const list = /^invalid: lists\.(\w+)/.exec(message);
  if (list) return `Your ${LIST_NAMES[list[1]] ?? list[1]} can't be exported: there are too many.`;
  return "Your setup can't be exported. Details are in the debug log.";
}

/**
 * The body of an export or a backup from this computer's setup: only the ticked
 * parts; passwords only with 'logins'. A file playlist still waiting to be
 * imported (pending) travels as that content, since its channels aren't stored yet.
 */
export function buildSetupBody(
  parts: SetupPart[],
  stored: { sources: SetupSource[]; settings: AppSettings },
  lists: UserLists,
  playlists: Record<string, string>,
  meta: { app: string; exportedAt: string; platform: string },
  pending: Record<string, string> = {},
): SetupBody {
  const { sources, settings } = stored;
  const body: SetupBody = { ...meta, includes: parts };
  if (parts.includes('sources')) {
    body.sources = sources.map((s) => {
      const playlist = pending[s.id] ?? playlists[s.id];
      return {
        id: s.id, name: s.name, type: s.type, url: s.url, enabled: s.enabled,
        ...(s.epg_url !== undefined && { epg_url: s.epg_url }),
        ...(s.auto_load_epg !== undefined && { auto_load_epg: s.auto_load_epg }),
        ...(s.username !== undefined && { username: s.username }),
        ...(parts.includes('logins') && s.password && { password: s.password }),
        ...(playlist !== undefined && { playlist }),
      };
    });
  }
  if (parts.includes('settings')) body.settings = settingsForExport(settings);
  if (parts.includes('apiKeys')) body.apiKeys = { ...(settings.tmdbApiKey && { tmdb: settings.tmdbApiKey }), ...(settings.posterDbApiKey && { posterDb: settings.posterDbApiKey }), ...(settings.subdlApiKey && { subdl: settings.subdlApiKey }) };
  const l: UserLists = {};
  if (parts.includes('favorites') && lists.favorites) l.favorites = lists.favorites;
  if (parts.includes('watchlist') && lists.watchlist) l.watchlist = lists.watchlist;
  if (parts.includes('progress') && lists.progress) l.progress = lists.progress;
  if (parts.includes('settings') && lists.lastCategory) l.lastCategory = lists.lastCategory;
  if (Object.keys(l).length) body.lists = l;
  return body;
}
