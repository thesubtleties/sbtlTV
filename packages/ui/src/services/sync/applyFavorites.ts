// packages/ui/src/services/sync/applyFavorites.ts
/**
 * Channel favorites from the user's other computers, written into this computer's favorites: on this
 * computer's matching channel (which then answers to that computer's id too), or kept without a channel
 * until one turns up (rematchFavorites). A removal takes one id off a favorite; it goes with its last id.
 */
import type { FavoriteRecord } from '@sbtltv/core';
import { db, type StoredFavorite } from '../../db';
import { data } from '../../data/client';
import { useUIStore } from '../../stores/uiStore';
import { favoriteIds, favoriteKey, matchFavorite, sameIds, sourceHost, withId, type ChannelLite, type FavoriteId } from './favorites';

export interface MatchContext {
  /** Enabled sources: the only ones a favorite may land on */
  sources: { id: string; url: string }[];
  /** Every source: to tell a favorite's own id */
  allSources: { id: string; url: string }[];
  byId: Map<string, ChannelLite>;
  byGuide: ChannelLite[];
}
export type MatchContextLoader = (wanted: FavoriteId[]) => Promise<MatchContext>;

const waitingId = (i: FavoriteId) => `channel_sync_${i.host}_${i.ch}`;
const idOf = (r: FavoriteId): FavoriteId => ({ host: r.host, ch: r.ch, ...(r.guide ? { guide: r.guide } : {}) });

/** The rows, kept in step with the writes below, so a batch reads the table once. */
class Rows {
  private byRow = new Map<string, StoredFavorite>();
  constructor(rows: StoredFavorite[], private sources: MatchContext['allSources']) { for (const r of rows) this.byRow.set(r.id, r); }
  get(id: string) { return this.byRow.get(id); }
  withKey(key: string): StoredFavorite[] { return [...this.byRow.values()].filter((f) => favoriteIds(f, this.sources).some((i) => favoriteKey(i) === key)); }
  async put(f: StoredFavorite) { this.byRow.set(f.id, f); await db.favorites.put(f); }
  async drop(id: string) { this.byRow.delete(id); await db.favorites.delete(id); }
  all() { return [...this.byRow.values()]; }
}

/**
 * A favorite landing on this computer's channel: that channel's favorite (made here or not) answers to the
 * incoming ids too; a waiting row for them goes.
 */
async function place(rows: Rows, ids: FavoriteId[], name: string, streamId: string, added: Date, sources: MatchContext['allSources'], from?: string): Promise<void> {
  const id = `channel_${streamId}`;
  const here = rows.get(id);
  // A favorite made here keeps its own id (other computers learned it when it was made); one that only
  // came from other computers answers to their ids alone, so their removal takes it away here too
  let merged = here ? favoriteIds(here, sources) : [];
  for (const i of ids) merged = withId(merged, i);
  if (from && from !== id) await rows.drop(from);
  for (const i of ids) { const w = waitingId(i); if (w !== id && w !== from && rows.get(w)) await rows.drop(w); }
  if (here) { if (!here.ids || !sameIds(here.ids, merged)) await rows.put({ ...here, ids: merged }); }
  else await rows.put({ id, type: 'channel', stream_id: streamId, name, added, ids: merged });
}

export async function applyFavoriteRecords(records: FavoriteRecord[], load: MatchContextLoader = loadMatchContext): Promise<void> {
  const ctx = await load(records.filter((r) => !r.removed).map(idOf));
  await db.transaction('rw', db.favorites, async () => {
    const rows = new Rows(await db.favorites.where('type').equals('channel').toArray(), ctx.allSources);
    for (const r of records) {
      const key = favoriteKey(r);
      const same = rows.withKey(key);
      if (r.removed) {
        // Only favorites made before the removal: one made later here (or before joining) stays
        for (const f of same.filter((x) => +x.added <= r.at)) {
          const left = favoriteIds(f, ctx.allSources).filter((i) => favoriteKey(i) !== key);
          if (left.length) await rows.put({ ...f, ids: left }); else await rows.drop(f.id);
        }
        continue;
      }
      if (same.length) {
        // Already here under this id: a newer guide id or name is kept with it
        for (const f of same) {
          const ids = withId(favoriteIds(f, ctx.allSources), idOf(r));
          if (!f.ids || !sameIds(f.ids, ids)) await rows.put({ ...f, ids });
        }
        continue;
      }
      const streamId = matchFavorite(r, ctx);
      if (streamId) await place(rows, [idOf(r)], r.name, streamId, new Date(r.at), ctx.allSources);
      else await rows.put({ id: waitingId(r), type: 'channel', name: r.name, added: new Date(r.at), ids: [idOf(r)] });
    }
  });
}

/**
 * Favorites from other computers matched again (after a channel sync, a source added, turned on or off):
 * ones still waiting for a channel, and ones whose channel's source is gone or turned off.
 */
export async function rematchFavorites(load: MatchContextLoader = loadMatchContext): Promise<void> {
  const sources = useUIStore.getState().sources;
  const enabled = new Set(sources.filter((s) => s.enabled).map((s) => s.id));
  const onEnabled = (f: StoredFavorite) => !!f.stream_id && sources.some((s) => enabled.has(s.id) && f.stream_id!.startsWith(`${s.id}_`));
  const candidates = (await db.favorites.where('type').equals('channel').toArray()).filter((f) => f.ids?.length && !onEnabled(f));
  if (!candidates.length) return;
  const ctx = await load(candidates.flatMap((f) => f.ids!));
  await db.transaction('rw', db.favorites, async () => {
    const rows = new Rows(await db.favorites.where('type').equals('channel').toArray(), ctx.allSources);
    for (const c of candidates) {
      // Read again inside the transaction: a removal (or Remove) in the meantime wins
      const f = rows.get(c.id);
      if (!f?.ids?.length) continue;
      const streamId = f.ids.map((i) => matchFavorite({ ...i, name: f.name ?? '' }, ctx)).find((x) => x !== null);
      if (streamId && `channel_${streamId}` !== f.id) await place(rows, f.ids, f.name ?? '', streamId, f.added, ctx.allSources, f.id);
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
  const candidates = [...new Set(wanted.flatMap((w) => enabled.filter((s) => sourceHost(s) === w.host).map((s) => `${s.id}_${w.ch}`)))];
  const guides = [...new Set(wanted.map((w) => w.guide).filter((g): g is string => !!g))];
  const [byId, byGuide] = await Promise.all([
    candidates.length ? data.query({ type: 'channelsByIds', streamIds: candidates }) : Promise.resolve([]),
    guides.length ? data.query({ type: 'channelsByGuideIds', guideIds: guides, sourceIds: enabled.map((s) => s.id) }) : Promise.resolve([]),
  ]);
  const lite = (c: { stream_id: string; source_id: string; name: string; channel_num?: number | null; epg_channel_id?: string | null; guide_ids?: string[] }): ChannelLite =>
    ({ stream_id: c.stream_id, source_id: c.source_id, name: c.name, channel_num: c.channel_num ?? null, guides: [...new Set([...(c.guide_ids ?? []), ...(c.epg_channel_id ? [c.epg_channel_id] : [])])] });
  return { ...base, byId: new Map(byId.map((c) => [c.stream_id, lite(c)])), byGuide: byGuide.map(lite) };
};
