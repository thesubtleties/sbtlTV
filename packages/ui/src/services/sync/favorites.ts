// packages/ui/src/services/sync/favorites.ts
/**
 * Synced channel favorites: who a favorite is (the provider's server name and its channel id, plus
 * the guide id), and which of this computer's channels it lands on.
 *
 * A favorite can be known by several ids: its own (made here, saved when it was made) and the ones
 * the same favorite has on the user's other computers. Unfavoriting removes it under every one, so
 * every computer drops it; a favorite goes once its last id is removed.
 */
import type { FavoriteRecord } from '@sbtltv/core';

export interface FavoriteId { host: string; ch: string; guide?: string }
/** A channel as matching needs it; `guides`: its guide ids (the app's guide links and the provider's tvg-id) */
export interface ChannelLite { stream_id: string; source_id: string; name: string; channel_num: number | null; guides: string[] }

export const favoriteKey = (i: { host: string; ch: string }): string => `${i.host}:${i.ch}`;
export const sameIds = (a: FavoriteId[], b: FavoriteId[]): boolean => a.length === b.length && a.every((x, i) => favoriteKey(x) === favoriteKey(b[i]));

/** The server a source connects to, name only (never a login, port or path; no "www."); a playlist from a file is 'file'. */
export function sourceHost(source: { url: string }): string {
  if (source.url.startsWith('imported:')) return 'file';
  try {
    const host = new URL(source.url).hostname.toLowerCase();
    return host ? host.replace(/^www\./, '') : 'file';
  } catch { return 'file'; }
}

/** A channel's id without this computer's source prefix: the provider's channel number, or the playlist entry's hash. */
export function channelPart(streamId: string, sourceId: string): string {
  return streamId.startsWith(`${sourceId}_`) ? streamId.slice(sourceId.length + 1) : streamId;
}

/** This computer's own id for one of its channels (from the source in its id); null if the source is gone. */
export function localId(streamId: string, sources: { id: string; url: string }[], guide?: string): FavoriteId | null {
  const s = sources.find((x) => streamId.startsWith(`${x.id}_`));
  if (!s) return null;
  return { host: sourceHost(s), ch: channelPart(streamId, s.id), ...(guide ? { guide } : {}) };
}

/** Every id a favorite answers to: the ones it saved, else its own channel's (a favorite from before Sync). */
export function favoriteIds(row: { stream_id?: string; ids?: FavoriteId[] }, sources: { id: string; url: string }[]): FavoriteId[] {
  if (row.ids?.length) return row.ids;
  const own = row.stream_id ? localId(row.stream_id, sources) : null;
  return own ? [own] : [];
}

/** ids with another one added (same key: the newer guide id wins). */
export function withId(ids: FavoriteId[], id: FavoriteId): FavoriteId[] {
  const rest = ids.filter((x) => favoriteKey(x) !== favoriteKey(id));
  return [...rest, id];
}

export function favoriteRecord(f: { host: string; ch: string; guide?: string; name: string }, at: number, removed = false): FavoriteRecord {
  return { k: 'fav', host: f.host, ch: f.ch, ...(f.guide ? { guide: f.guide } : {}), name: f.name, at, ...(removed ? { removed: true as const } : {}) };
}

/** Letters and digits only, any script ("Первый канал" stays comparable). */
const loose = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * This computer's channel for a favorite from another computer: the same provider and channel among the
 * given (enabled) sources, else a channel with the same guide id (closest name, then lowest number); null if
 * none. Several channels sharing a guide id with no name like the favorite's ("PPV", "dummy"): no guess.
 */
export function matchFavorite(
  rec: { host: string; ch: string; guide?: string; name: string },
  ctx: { sources: { id: string; url: string }[]; byId: Map<string, ChannelLite>; byGuide: ChannelLite[] },
): string | null {
  for (const s of ctx.sources) {
    if (sourceHost(s) !== rec.host) continue;
    const hit = ctx.byId.get(`${s.id}_${rec.ch}`);
    if (hit) return hit.stream_id;
  }
  if (!rec.guide) return null;
  const enabled = new Set(ctx.sources.map((s) => s.id));
  const pool = ctx.byGuide.filter((c) => c.guides.includes(rec.guide!) && enabled.has(c.source_id));
  if (!pool.length) return null;
  const want = loose(rec.name);
  const score = (c: ChannelLite) => (c.name === rec.name ? 0 : loose(c.name) === want ? 1 : want && (loose(c.name).includes(want) || want.includes(loose(c.name))) ? 2 : 3);
  const best = [...pool].sort((a, b) => score(a) - score(b) || (a.channel_num ?? Infinity) - (b.channel_num ?? Infinity) || a.name.length - b.name.length)[0];
  if (pool.length > 1 && score(best) === 3) return null;
  return best.stream_id;
}

/** Favorites from other computers with no channel here, shown (grayed) only with Gray out. */
export function waitingFavorites<T extends { stream_id?: string; ids?: FavoriteId[] }>(rows: T[], setting: 'hide' | 'gray'): T[] {
  return setting === 'gray' ? rows.filter((f) => f.ids?.length && !f.stream_id) : [];
}
