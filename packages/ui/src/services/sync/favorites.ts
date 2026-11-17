// packages/ui/src/services/sync/favorites.ts
/**
 * Synced channel favorites: who a favorite is (the provider's server name and its channel id, plus
 * the guide id), and which of this computer's channels it lands on.
 */
import type { FavoriteRecord } from '@sbtltv/core';

export interface ChannelLite { stream_id: string; source_id: string; name: string; channel_num: number | null; epg_channel_id: string }

/** The server a source connects to, name only (never a login, port or path); a playlist from a file is 'file'. */
export function sourceHost(source: { url: string }): string {
  if (source.url.startsWith('imported:')) return 'file';
  try { return new URL(source.url).hostname.toLowerCase() || 'file'; } catch { return 'file'; }
}

/** A channel's id without this computer's source prefix: the provider's channel number, or the playlist entry's hash. */
export function channelPart(streamId: string, sourceId: string): string {
  return streamId.startsWith(`${sourceId}_`) ? streamId.slice(sourceId.length + 1) : streamId;
}

export function favoriteRecord(f: { host: string; ch: string; guide?: string; name: string }, at: number, removed = false): FavoriteRecord {
  return { k: 'fav', host: f.host, ch: f.ch, ...(f.guide ? { guide: f.guide } : {}), name: f.name, at, ...(removed ? { removed: true as const } : {}) };
}

const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * This computer's channel for a favorite from another computer: the same provider and channel among the
 * given (enabled) sources, else a channel with the same guide id (closest name, then lowest number); null if none.
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
  const pool = ctx.byGuide.filter((c) => c.epg_channel_id === rec.guide && enabled.has(c.source_id));
  if (!pool.length) return null;
  const want = loose(rec.name);
  const score = (c: ChannelLite) => (c.name === rec.name ? 0 : loose(c.name) === want ? 1 : want && loose(c.name).includes(want) ? 2 : 3);
  const best = [...pool].sort((a, b) => score(a) - score(b) || (a.channel_num ?? Infinity) - (b.channel_num ?? Infinity) || a.name.length - b.name.length)[0];
  return best.stream_id;
}

/**
 * What a favorite on this computer is called for Sync: the identity it came with (so a removal reaches
 * every computer), else its own source's server and channel id, with its guide id. null if unknown.
 */
export function favoriteIdentity(
  row: { stream_id?: string; sync?: { host: string; ch: string; guide?: string } },
  lookup: { sources: { id: string; url: string }[]; channel?: { source_id: string; epg_channel_id?: string | null } },
): { host: string; ch: string; guide?: string } | null {
  if (row.sync) return row.sync;
  if (!row.stream_id || !lookup.channel) return null;
  const source = lookup.sources.find((s) => s.id === lookup.channel!.source_id);
  if (!source) return null;
  const guide = lookup.channel.epg_channel_id;
  return { host: sourceHost(source), ch: channelPart(row.stream_id, source.id), ...(guide ? { guide } : {}) };
}
