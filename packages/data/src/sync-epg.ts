import type { Source, Channel } from '@sbtltv/core';
import { matchChannelsToEpg, buildEpgLinks, redactUrl } from '@sbtltv/core';
import type { StageContext } from './sync-channels.js';
import { commitStagedEpg } from './writes.js';
import { openStaging, type GuideStaging } from './guide-staging.js';
import { downloadToTempFile, decompressToFile, parseXmltvFile } from './epg.js';

// One EPG setting may hold several URLs, comma separated (kept from sync.ts).
// `epgSource` names the guide in epg_programs/epg_links: 'xtream://<url>' for the
// panel's built-in guide, the URL itself for an override.
export async function syncEpg(ctx: StageContext, source: Source, channels: Channel[], epgUrl: string, epgSource: string): Promise<number> {
  ctx.progress({ sourceId: source.id, stage: 'epg', state: 'started' });
  ctx.log('epg', `Starting EPG sync for source ${source.id}`);
  const urls = epgUrl.split(',').map((u) => u.trim()).filter(Boolean);
  const providerChannels = channels.map((c) => ({ epg_channel_id: c.epg_channel_id, name: c.name, stream_id: c.stream_id }));
  const allChannels = new Map<string, { id: string; displayNames: string[] }>();
  const failedUrls: string[] = [];
  // Programmes are staged on disk as they are parsed (guide-staging.ts), never held whole in memory.
  let staging: GuideStaging | null = null;
  try {
    staging = openStaging(ctx.db, ctx.platform, ctx.stagingDir, source.id, epgSource);
    const stage = staging;
    for (const url of urls) {
      ctx.log('epg', `Fetching XMLTV from: ${redactUrl(url)}`);
      let tmp: string;
      try {
        tmp = await downloadToTempFile(ctx.platform, url, ctx.tempDir, (m) => ctx.log('net', m), ctx.allowLanSources);
      } catch (e) {
        failedUrls.push(redactUrl(url));
        ctx.log('epg', `EPG WARNING: fetch failed for ${redactUrl(url)}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      let xmlPath = tmp;
      try {
        const out = await decompressToFile(ctx.platform, tmp, (m) => ctx.log('epg', m));
        xmlPath = out.xmlPath;
        const parsed = await parseXmltvFile(ctx.platform, xmlPath, providerChannels, (m) => ctx.log('epg', m),
          (p) => stage.add({ epg_channel_id: p.channel_id, startMs: p.startMs, endMs: p.endMs, title: p.title, description: p.description }));
        for (const c of parsed.channels) allChannels.set(c.id, c);
      } finally {
        await ctx.platform.files.removeAsync(xmlPath).catch(() => {});
        if (xmlPath !== tmp) await ctx.platform.files.removeAsync(tmp).catch(() => {});
      }
    }
    if (failedUrls.length > 0 && failedUrls.length === urls.length) {
      throw new Error(`every EPG URL failed: ${failedUrls.join(', ')}`);
    }
    if (failedUrls.length > 0) {
      ctx.log('epg', `EPG WARNING: ${failedUrls.length}/${urls.length} EPG URLs failed: ${failedUrls.join(', ')}`);
    }
    ctx.log('epg', `Total from all EPG sources: ${stage.parsed} programs, ${allChannels.size} channels`);
    if (stage.parsed === 0) {
      ctx.log('epg', 'WARNING: No programs parsed! Keeping existing EPG data to avoid data loss');
      ctx.progress({ sourceId: source.id, stage: 'epg', state: 'finished', counts: { programs: 0 } });
      return 0;
    }
    const xmltvChannels = [...allChannels.values()];
    const mappings = matchChannelsToEpg(channels, xmltvChannels, source.id, epgSource);
    if (mappings.length > 0) {
      const byStrategy = new Map<string, number>();
      for (const m of mappings) byStrategy.set(m.strategy, (byStrategy.get(m.strategy) || 0) + 1);
      const strategyStr = [...byStrategy.entries()].map(([s, n]) => `${s}=${n}`).join(', ');
      ctx.log('epg', `EPG matching: ${mappings.length}/${channels.length} channels matched (${strategyStr})`);
    }
    const links = buildEpgLinks(channels, mappings, new Set(allChannels.keys()));
    ctx.log('epg', `EPG links: ${links.length}/${channels.length} channels linked to a guide channel`);
    if (links.length === 0) {
      ctx.log('epg', 'WARNING: No channels linked! Keeping existing EPG data to avoid data loss');
      ctx.progress({ sourceId: source.id, stage: 'epg', state: 'finished', counts: { programs: 0, linked: 0 } });
      return 0;
    }
    ctx.log('epg', 'Clearing old EPG data and storing new...');
    const t0 = Date.now();
    const tables = commitStagedEpg(ctx.db, stage, links);
    ctx.changed(tables, source.id);
    ctx.log('epg', `EPG sync complete: ${stage.parsed} programs stored in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    ctx.progress({ sourceId: source.id, stage: 'epg', state: 'finished', counts: { programs: stage.parsed, linked: links.length } });
    return stage.parsed;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ctx.log('epg', `EPG WARNING: sync completed with error: ${message}`);
    ctx.log('epg', 'Keeping existing EPG data');
    ctx.progress({ sourceId: source.id, stage: 'epg', state: 'failed', message });
    return 0;
  } finally {
    // Cleanup never turns a finished sync into a crashed job; a file left behind is swept at the next start.
    try { staging?.discard(); } catch (e) { ctx.log('epg', `EPG staging cleanup failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
}
