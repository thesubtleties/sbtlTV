// packages/ui/src/services/sync/applyFavorites.ts
/**
 * Channel favorites from the user's other computers, written into this computer's favorites: on this
 * computer's matching channel, or kept without a channel until one turns up (rematchFavorites).
 */
import type { FavoriteRecord } from '@sbtltv/core';
import { db, type StoredFavorite } from '../../db';
import { data } from '../../data/client';
import { useUIStore } from '../../stores/uiStore';
import { channelPart, matchFavorite, sourceHost, type ChannelLite } from './favorites';

type Identity = { host: string; ch: string; guide?: string };
export interface MatchContext {
  /** Enabled sources: the only ones a favorite may land on */
  sources: { id: string; url: string }[];
  /** Every source: to tell which favorite a local one is */
  allSources: { id: string; url: string }[];
  byId: Map<string, ChannelLite>;
  byGuide: ChannelLite[];
}
export type MatchContextLoader = (wanted: Identity[]) => Promise<MatchContext>;

const keyOf = (i: { host: string; ch: string }) => `${i.host}:${i.ch}`;
const waitingId = (i: { host: string; ch: string }) => `channel_sync_${i.host}_${i.ch}`;
const identity = (r: Identity): Identity => ({ host: r.host, ch: r.ch, ...(r.guide ? { guide: r.guide } : {}) });

/** Which synced favorite a row is: the identity it came with, else its own channel's provider and channel id. */
export function identityOf(f: StoredFavorite, allSources: { id: string; url: string }[]): Identity | null {
  if (f.sync) return f.sync;
  if (!f.stream_id) return null;
  const s = allSources.find((x) => f.stream_id!.startsWith(`${x.id}_`));
  return s ? { host: sourceHost(s), ch: channelPart(f.stream_id, s.id) } : null;
}

/** The channel a favorite lands on: this computer's row for it (keeping a local favorite as it is), replacing a waiting one. */
async function place(r: Identity & { name: string }, streamId: string, added: Date): Promise<void> {
  await db.favorites.delete(waitingId(r));
  const id = `channel_${streamId}`;
  const here = await db.favorites.get(id);
  if (here) { if (!here.sync) await db.favorites.update(id, { sync: identity(r) }); return; }
  await db.favorites.put({ id, type: 'channel', stream_id: streamId, name: r.name, added, sync: identity(r) });
}

export async function applyFavoriteRecords(records: FavoriteRecord[], load: MatchContextLoader = loadMatchContext): Promise<void> {
  const ctx = await load(records.filter((r) => !r.removed));
  await db.transaction('rw', db.favorites, async () => {
    for (const r of records) {
      const rows = await db.favorites.where('type').equals('channel').toArray();
      const same = rows.filter((f) => { const i = identityOf(f, ctx.allSources); return i !== null && keyOf(i) === keyOf(r); });
      if (r.removed) {
        // Only favorites made before the removal: one made later here (or before joining) stays
        await db.favorites.bulkDelete(same.filter((f) => +f.added <= r.at).map((f) => f.id));
        continue;
      }
      const streamId = matchFavorite(r, ctx);
      if (streamId) await place(r, streamId, new Date(r.at));
      else if (!same.length) await db.favorites.put({ id: waitingId(r), type: 'channel', name: r.name, added: new Date(r.at), sync: identity(r) });
    }
  });
}

/** Favorites still waiting for their channel: matched again (after a channel sync, or a source added or turned on). */
export async function rematchFavorites(load: MatchContextLoader = loadMatchContext): Promise<void> {
  const waiting = (await db.favorites.where('type').equals('channel').toArray()).filter((f) => f.sync && !f.stream_id);
  if (!waiting.length) return;
  const ctx = await load(waiting.map((f) => f.sync!));
  await db.transaction('rw', db.favorites, async () => {
    for (const f of waiting) {
      const streamId = matchFavorite({ ...f.sync!, name: f.name ?? '' }, ctx);
      if (streamId) await place({ ...f.sync!, name: f.name ?? '' }, streamId, f.added);
    }
  });
}

/** This computer's candidates for some favorites: same provider + channel among enabled sources, and channels with their guide ids. */
export const loadMatchContext: MatchContextLoader = async (wanted) => {
  const all = useUIStore.getState().sources;
  const enabled = all.filter((s) => s.enabled);
  const base = { sources: enabled, allSources: all, byId: new Map<string, ChannelLite>(), byGuide: [] as ChannelLite[] };
  // No enabled source: nothing to land on (an empty source list would mean "all sources" to the data process)
  if (!enabled.length || !wanted.length) return base;
  const candidates = wanted.flatMap((w) => enabled.filter((s) => sourceHost(s) === w.host).map((s) => `${s.id}_${w.ch}`));
  const guides = [...new Set(wanted.map((w) => w.guide).filter((g): g is string => !!g))];
  const [byId, byGuide] = await Promise.all([
    candidates.length ? data.query({ type: 'channelsByIds', streamIds: candidates }) : Promise.resolve([]),
    guides.length ? data.query({ type: 'channelsByGuideIds', guideIds: guides, sourceIds: enabled.map((s) => s.id) }) : Promise.resolve([]),
  ]);
  const lite = (c: { stream_id: string; source_id: string; name: string; channel_num?: number | null; epg_channel_id?: string | null }): ChannelLite =>
    ({ stream_id: c.stream_id, source_id: c.source_id, name: c.name, channel_num: c.channel_num ?? null, epg_channel_id: c.epg_channel_id ?? '' });
  return { ...base, byId: new Map(byId.map((c) => [c.stream_id, lite(c)])), byGuide: byGuide.map(lite) };
};
