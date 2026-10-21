// SubDL v2 (https://subdl.com/developers): search by TMDB id, download one
// file, usage. The key goes only in the Authorization header: search results
// repeat it inside their `url` fields, so those are never kept. HTTP is
// injected (main passes electronNet.fetch), so this runs under node:test.

import { subdlCode } from './subtitle-languages.js';

export const SUBDL_API = 'https://api.subdl.com';
export const SUBDL_FILES = 'https://dl.subdl.com';
const MAX_JSON = 1024 * 1024;
const MAX_FILE = 2 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_ID = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/;
const PAGE = /^\/s\/info\/([A-Za-z0-9_-]{1,64})$/;
const FORMATS = new Set(['srt', 'vtt', 'ass', 'ssa']);

export interface SubdlTitle { tmdbId: number; type: 'movie' | 'tv'; season?: number; episode?: number }
/** One downloadable file. nId = `<pageId>/<file_n_id>`. */
export interface SubdlResult {
  nId: string;
  releaseName: string;
  /** SubDL's code, lowercased: en, br_pt */
  language: string;
  hi: boolean;
  ai: boolean;
  author: string | null;
  season: number | null;
  episode: number | null;
  /** From a season pack */
  pack: boolean;
  popularity: number | null;
  fps: number | null;
}
export interface SubdlUsage { downloadsLeft: number; downloadsLimit: number; searchesLeft: number | null }
export type SubdlErrorKind = 'auth' | 'quota' | 'not-found' | 'network' | 'bad-response';
export interface HttpResponse { status: number; headers: Record<string, string>; body: Uint8Array }
export type HttpGet = (url: string, headers: Record<string, string>, maxBytes: number) => Promise<HttpResponse>;

export class SubdlError extends Error {
  constructor(readonly kind: SubdlErrorKind, message: string = kind) {
    super(message);
    this.name = 'SubdlError';
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
};
const yes = (v: unknown) => v === true || v === 1 || v === '1';
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);

function fpsOf(sub: Record<string, unknown>, name: string | null): number | null {
  const given = num(sub.fps);
  if (given !== null && given > 0) return given;
  const m = name ? /\[(\d{2}(?:\.\d+)?) ?FPS\]/i.exec(name) : null;
  return m ? Number(m[1]) : null;
}

/** Search results -> one entry per subtitle file SubDL unpacked. Results without unpacked files are skipped. */
export function parseSearch(json: unknown): SubdlResult[] {
  const list = obj(json)?.subtitles;
  if (!Array.isArray(list)) return [];
  const out: SubdlResult[] = [];
  for (const item of list) {
    const sub = obj(item);
    if (!sub) continue;
    const pageId = PAGE.exec(str(sub.subtitlePage) ?? '')?.[1];
    if (!pageId || !Array.isArray(sub.unpack_files)) continue;
    const subRelease = str(sub.release_name) ?? str(sub.name);
    for (const f of sub.unpack_files) {
      const file = obj(f);
      const fileId = str(file?.file_n_id);
      if (!file || !fileId || !ID.test(fileId)) continue;
      if (!FORMATS.has(String(file.format ?? '').toLowerCase())) continue;
      const size = num(file.size);
      if (size !== null && size > MAX_FILE) continue;
      const season = num(file.season) || num(sub.season) || null;
      out.push({
        nId: `${pageId}/${fileId}`,
        releaseName: (str(file.release_name) ?? subRelease ?? fileId).slice(0, 200),
        language: (str(file.language) ?? str(sub.language) ?? '').toLowerCase(),
        hi: yes(file.hi ?? sub.hi),
        ai: yes(sub.ai),
        author: str(sub.author),
        season,
        episode: num(file.episode) ?? num(sub.episode),
        pack: yes(sub.full_season),
        popularity: null,
        fps: fpsOf(sub, subRelease),
      });
    }
  }
  return out;
}

export function parseUsage(json: unknown): SubdlUsage | null {
  const usage = obj(obj(json)?.usage);
  const downloads = obj(usage?.downloads);
  const left = num(downloads?.remaining);
  const limit = num(downloads?.limit);
  if (left === null || limit === null) return null;
  return { downloadsLeft: left, downloadsLimit: limit, searchesLeft: num(obj(usage?.search)?.remaining) };
}

export function errorKind(status: number, json: unknown, _headers: Record<string, string>): SubdlErrorKind | null {
  const code = obj(obj(json)?.error)?.code;
  if (code === 'quota_exceeded' || status === 429) return 'quota';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not-found';
  if (status >= 500) return 'network';
  if (status >= 400) return 'bad-response';
  return null;
}

export class SubdlClient {
  constructor(private readonly http: HttpGet, private readonly key: () => string | null) {}

  /** url: an api.subdl.com path, or a full dl.subdl.com URL. */
  private async get(url: string, maxBytes: number): Promise<HttpResponse> {
    const key = this.key();
    if (!key) throw new SubdlError('auth', 'no key');
    let res: HttpResponse;
    try {
      res = await this.http(url.startsWith('https://') ? url : `${SUBDL_API}${url}`, { Authorization: `Bearer ${key}`, Accept: 'application/json' }, maxBytes);
    } catch (e) {
      // Only the error's name: its message can carry the URL
      throw new SubdlError('network', e instanceof Error ? e.name : 'request failed');
    }
    if (res.status >= 400) {
      let body: unknown = null;
      try { body = JSON.parse(new TextDecoder().decode(res.body)); } catch { /* not JSON */ }
      throw new SubdlError(errorKind(res.status, body, res.headers) ?? 'bad-response', `HTTP ${res.status}`);
    }
    return res;
  }

  private async json(path: string): Promise<unknown> {
    const res = await this.get(path, MAX_JSON);
    try {
      return JSON.parse(new TextDecoder().decode(res.body));
    } catch {
      throw new SubdlError('bad-response', 'not JSON');
    }
  }

  async search(title: SubdlTitle, language: string): Promise<SubdlResult[]> {
    const q = new URLSearchParams({ tmdb_id: String(title.tmdbId), type: title.type, unpack: '1', subs_per_page: '30' });
    const lang = subdlCode(language);
    if (lang) q.set('languages', lang.toLowerCase());
    if (title.type === 'tv' && title.season != null && title.episode != null) {
      q.set('season', String(title.season));
      q.set('episode', String(title.episode));
    }
    return parseSearch(await this.json(`/api/v2/subtitles/search?${q}`));
  }

  /** One subtitle file. Every call costs a daily download, even a failed one. */
  async download(nId: string): Promise<Uint8Array> {
    if (!FILE_ID.test(nId)) throw new SubdlError('bad-response', 'bad id');
    return (await this.get(`${SUBDL_FILES}/subtitle/${nId}`, MAX_FILE)).body;
  }

  async usage(): Promise<SubdlUsage> {
    const u = parseUsage(await this.json('/api/v2/me'));
    if (!u) throw new SubdlError('bad-response', 'no usage');
    return u;
  }
}
