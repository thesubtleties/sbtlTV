import type { PlaylistRow } from '@sbtltv/core';
import { data } from '../../data/client';
import type { Source } from '../../types/electron';
import { buildM3U } from './playlist';

/** Rebuilt playlists for every file-based M3U source, by source id (they exist only as stored channels). */
export async function rebuildFilePlaylists(sources: Source[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const s of sources) {
    if (s.type !== 'm3u' || !s.url.startsWith('imported:')) continue;
    const rows = (await data.query({ type: 'playlistRows', sourceId: s.id })) as PlaylistRow[];
    out[s.id] = buildM3U(rows, s.epg_url || undefined);
  }
  return out;
}
