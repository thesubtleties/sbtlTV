import type { PlaylistRow, SourceMetaRow } from '@sbtltv/core';
import { data } from '../../data/client';
import type { Source } from '../../types/electron';
import { buildM3U, playlistGuideUrl } from './playlist';

/** Rebuilt playlists for every file-based M3U source, by source id (they exist only as stored channels). */
export async function rebuildFilePlaylists(sources: Source[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const fileSources = sources.filter((s) => s.type === 'm3u' && s.url.startsWith('imported:'));
  if (!fileSources.length) return out;
  const metas = (await data.query({ type: 'syncStatus' })) as SourceMetaRow[];
  for (const s of fileSources) {
    const rows = (await data.query({ type: 'playlistRows', sourceId: s.id })) as PlaylistRow[];
    out[s.id] = buildM3U(rows, playlistGuideUrl(s, metas.find((m) => m.source_id === s.id)?.epg_url));
  }
  return out;
}
