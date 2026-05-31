import type { ProgressRecord } from './types';
import { seriesKey } from './series-key';

/** Group episode progress records by stable series identity. Non-identifiable records are dropped. */
export function groupBySeriesKey(records: ProgressRecord[]): Map<string, ProgressRecord[]> {
  const map = new Map<string, ProgressRecord[]>();
  for (const r of records) {
    if (r.type !== 'episode') continue;
    const key = seriesKey({ seriesTmdbId: r.series_tmdb_id, sourceId: r.source_id, seriesStreamId: r.series_stream_id });
    if (!key) continue;
    let arr = map.get(key);
    if (!arr) map.set(key, arr = []);
    arr.push(r);
  }
  return map;
}
