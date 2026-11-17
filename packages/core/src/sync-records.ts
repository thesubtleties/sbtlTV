// packages/core/src/sync-records.ts
/**
 * Sync records: what one computer says about a title or a setting, keyed by TMDB identity so it
 * means the same thing on a computer with different providers. Browser-safe (no Node imports):
 * the renderer builds and applies them, the main process stores, seals and merges them.
 */
export const SYNCED_SETTING_KEYS = ['theme', 'appearance', 'subtitles', 'autoplayNextEpisode'] as const;
export type SyncedSettingKey = (typeof SYNCED_SETTING_KEYS)[number];

interface Base { at: number; removed?: true }
export interface WatchlistRecord extends Base { k: 'wl'; type: 'movie' | 'series'; tmdb: number; name: string }
export interface MovieProgressRecord extends Base { k: 'pm'; tmdb: number; name: string; pos: number; dur: number; done: boolean }
export interface EpisodeProgressRecord extends Base { k: 'pe'; series: number; s: number; e: number; name: string; pos: number; dur: number; done: boolean }
export interface SettingRecord { k: 'set'; key: SyncedSettingKey; value: unknown; at: number }
export type SyncRecord = WatchlistRecord | MovieProgressRecord | EpisodeProgressRecord | SettingRecord;

export function recordKey(r: SyncRecord): string {
  switch (r.k) {
    case 'wl': return `wl:${r.type}:${r.tmdb}`;
    case 'pm': return `pm:${r.tmdb}`;
    case 'pe': return `pe:${r.series}:${r.s}:${r.e}`;
    case 'set': return `set:${r.key}`;
  }
}

export function recordPart(r: SyncRecord): 'watchlist' | 'progress' | 'settings' {
  return r.k === 'wl' ? 'watchlist' : r.k === 'set' ? 'settings' : 'progress';
}

/** Same answer on every computer: later wins; on a tie a removal wins, then the larger JSON text. */
export function isNewer(a: SyncRecord, b: SyncRecord | undefined): boolean {
  if (!b) return true;
  if (a.at !== b.at) return a.at > b.at;
  const ar = 'removed' in a && a.removed ? 1 : 0, br = 'removed' in b && b.removed ? 1 : 0;
  if (ar !== br) return ar > br;
  return JSON.stringify(a) > JSON.stringify(b);
}

export function mergeRecords(sets: Iterable<SyncRecord>[]): Map<string, SyncRecord> {
  const out = new Map<string, SyncRecord>();
  for (const set of sets) for (const r of set) {
    const key = recordKey(r);
    if (isNewer(r, out.get(key))) out.set(key, r);
  }
  return out;
}

const TOMBSTONE_DAYS = 90;
export function pruneTombstones(records: Map<string, SyncRecord>, now: number, days = TOMBSTONE_DAYS): Map<string, SyncRecord> {
  const cutoff = now - days * 86_400_000;
  return new Map([...records].filter(([, r]) => !('removed' in r && r.removed && r.at < cutoff)));
}

const id = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 2 ** 31;
const small = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e7;
const time = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1e14;
const name = (v: unknown): v is string => typeof v === 'string' && v.length <= 500;
/** A setting value from another computer: plain JSON, small. */
const settingValue = (v: unknown): boolean => {
  try { return v !== undefined && JSON.stringify(v).length <= 16_384; } catch { return false; }
};

/** A record from another computer's box, rebuilt from known fields only; null if anything is off. */
export function validateRecord(v: unknown): SyncRecord | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!time(o.at)) return null;
  const removed = o.removed === true ? { removed: true as const } : {};
  if (o.removed !== undefined && o.removed !== true) return null;
  switch (o.k) {
    case 'wl':
      if ((o.type !== 'movie' && o.type !== 'series') || !id(o.tmdb) || !name(o.name)) return null;
      return { k: 'wl', type: o.type, tmdb: o.tmdb, name: o.name, at: o.at, ...removed };
    case 'pm':
      if (!id(o.tmdb) || !name(o.name) || !num(o.pos) || !num(o.dur) || typeof o.done !== 'boolean') return null;
      return { k: 'pm', tmdb: o.tmdb, name: o.name, pos: o.pos, dur: o.dur, done: o.done, at: o.at, ...removed };
    case 'pe':
      if (!id(o.series) || !small(o.s) || !small(o.e) || !name(o.name) || !num(o.pos) || !num(o.dur) || typeof o.done !== 'boolean') return null;
      return { k: 'pe', series: o.series, s: o.s, e: o.e, name: o.name, pos: o.pos, dur: o.dur, done: o.done, at: o.at, ...removed };
    case 'set':
      if (!(SYNCED_SETTING_KEYS as readonly unknown[]).includes(o.key) || !settingValue(o.value) || o.removed !== undefined) return null;
      return { k: 'set', key: o.key as SyncedSettingKey, value: o.value, at: o.at };
    default:
      return null;
  }
}
