import { describe, it, expect } from 'vitest';
import { groupBySeriesKey } from './grouping';
import type { ProgressRecord } from './types';

const rec = (o: Partial<ProgressRecord>): ProgressRecord => ({
  id: 'x', type: 'episode', position: 0, duration: 1000, progress: 10,
  completed: false, updated_at: new Date(0), season_num: 1, episode_num: 1, ...o,
});

describe('groupBySeriesKey', () => {
  it('groups episodes of one series (by tmdb) into a single bucket', () => {
    const groups = groupBySeriesKey([
      rec({ id: 'a', series_tmdb_id: 1, episode_num: 1 }),
      rec({ id: 'b', series_tmdb_id: 1, episode_num: 3 }),
      rec({ id: 'c', series_tmdb_id: 2, episode_num: 1 }),
    ]);
    expect(groups.get('1')!.length).toBe(2);
    expect(groups.get('2')!.length).toBe(1);
  });
  it('groups non-tmdb episodes by source+series-stream', () => {
    const groups = groupBySeriesKey([
      rec({ id: 'a', source_id: 's', series_stream_id: 'X' }),
      rec({ id: 'b', source_id: 's', series_stream_id: 'X', episode_num: 2 }),
    ]);
    expect(groups.get('src:s:X')!.length).toBe(2);
  });
  it('drops records that cannot be identified', () => {
    const groups = groupBySeriesKey([rec({ id: 'a' })]); // no tmdb, no stream
    expect(groups.size).toBe(0);
  });
});
