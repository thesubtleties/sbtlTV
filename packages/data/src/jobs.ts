/**
 * What a sync job does, once a thread or process has picked it up (moved from Electron's sync-worker). The caller owns
 * the database connection and hands it over in the StageContext.
 */
import type { Source, Channel } from '@sbtltv/core';
import type { StageContext } from './sync-stages.js';
import { syncChannels, makeXtreamClient, syncEpg, syncVod, syncEpisodes, matchTmdb } from './sync-stages.js';
import { deleteSource, clearAll, updateVodDetails } from './writes.js';
import type { SyncJob } from './router.js';

// The guide selection mirrors the old renderer sync: auto-load means the panel's
// built-in guide for Xtream (or the playlist's url-tvg for M3U); a manual
// override URL is used only when auto-load is off.
async function syncGuide(c: StageContext, source: Source, channels: Channel[], playlistEpgUrl: string | undefined): Promise<void> {
  const shouldLoadEpg = source.auto_load_epg ?? source.type === 'xtream';
  if (shouldLoadEpg && source.type === 'xtream') {
    const url = makeXtreamClient(source)?.getEpgUrl();
    if (url) await syncEpg(c, source, channels, url, `xtream://${source.url}`);
  } else if (shouldLoadEpg && playlistEpgUrl) {
    await syncEpg(c, source, channels, playlistEpgUrl, playlistEpgUrl);
  }
  if (source.epg_url && !shouldLoadEpg) {
    await syncEpg(c, source, channels, source.epg_url, source.epg_url);
  }
}

export async function runJob(c: StageContext, sources: Source[], job: SyncJob): Promise<void> {
  if (job.kind === 'deleteSource') { c.changed(deleteSource(c.db, job.sourceId), job.sourceId); return; }
  if (job.kind === 'clearAll') { c.changed(clearAll(c.db), null); return; }
  if (job.kind === 'vodDetails') { c.changed(updateVodDetails(c.db, job.itemKind, job.itemId, job.fields), null); return; }
  const source = sources.find((s) => s.id === job.sourceId);
  if (!source) {
    c.log('sync', `Job ${job.kind} for unknown source ${job.sourceId} skipped`);
    // An open series page waits for this series' finished/failed event.
    if (job.kind === 'episodes') c.progress({ sourceId: job.sourceId, stage: 'episodes', state: 'failed', seriesId: job.seriesId, message: 'This source is no longer set up' });
    return;
  }
  switch (job.kind) {
    case 'channels': {
      const out = await syncChannels(c, source, makeXtreamClient(source));
      if (!out) return;
      await syncGuide(c, source, out.channels, out.epgUrl);
      return;
    }
    case 'importPlaylist': {
      const out = await syncChannels(c, source, null, job.content);
      if (!out) return;
      await syncGuide(c, source, out.channels, out.epgUrl);
      return;
    }
    case 'vod': {
      const client = makeXtreamClient(source);
      if (!client) return;
      const out = await syncVod(c, source, client);
      if (out) await matchTmdb(c, source);
      return;
    }
    case 'episodes': {
      const client = makeXtreamClient(source);
      if (client) await syncEpisodes(c, source, client, job.seriesId);
      else c.progress({ sourceId: source.id, stage: 'episodes', state: 'failed', seriesId: job.seriesId, message: 'This source has no login to fetch episodes with' });
      return;
    }
    case 'rematch': {
      c.log('epg', `Starting EPG rematch for source ${source.id}`);
      const rows = c.db.prepare(`select stream_id, source_id, name, stream_icon, epg_channel_id, direct_url from channels where source_id = ?`).all(source.id) as { stream_id: string; source_id: string; name: string; stream_icon: string; epg_channel_id: string; direct_url: string }[];
      if (rows.length === 0) { c.log('epg', 'No channels found for source, nothing to rematch'); return; }
      const channels: Channel[] = rows.map((r) => ({ ...r, category_ids: [] }));
      const meta = c.db.prepare(`select epg_url from sources_meta where source_id = ?`).get(source.id) as { epg_url?: string | null } | undefined;
      if (source.epg_url) await syncEpg(c, source, channels, source.epg_url, source.epg_url);
      else if (source.type === 'xtream') await syncGuide(c, source, channels, undefined);
      else if (meta?.epg_url) await syncEpg(c, source, channels, meta.epg_url, meta.epg_url);
      else c.log('epg', 'No EPG URL known for source, nothing to rematch');
      return;
    }
  }
}
