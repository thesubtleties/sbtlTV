import { describe, it, expect } from 'vitest';
import type { SyncProgress } from '@sbtltv/core';
import {
  episodeFetchReducer as reduce,
  initialEpisodeFetchState as initial,
  blockingMessage,
  warningText,
  NO_ANSWER_MESSAGE,
  type EpisodeFetchState,
} from './episodeFetchState';

const ev = (seriesId: string, state: SyncProgress['state'], extra: Partial<SyncProgress> = {}) =>
  ({ type: 'progress', progress: { sourceId: seriesId.split('_')[0], stage: 'episodes', state, seriesId, ...extra } }) as const;
const names: Record<string, string> = { a: 'Alpha', b: 'Beta' };
const name = (id: string) => names[id] ?? id;

describe('episode fetch state', () => {
  it('a queued fetch is pending until its finished event', () => {
    let s = reduce(initial, { type: 'queued', seriesId: 'a_1', sourceId: 'a' });
    s = reduce(s, ev('a_1', 'started'));
    expect(s.fetching).toHaveLength(1);
    s = reduce(s, ev('a_1', 'finished', { counts: { episodes: 12 } }));
    expect(s).toEqual(initial);
  });

  it('an empty reply is an issue for that source, not a success', () => {
    let s = reduce(initial, { type: 'queued', seriesId: 'a_1', sourceId: 'a' });
    s = reduce(s, ev('a_1', 'finished', { counts: { episodes: 0 } }));
    expect(s.fetching).toEqual([]);
    expect(s.issues).toEqual([{ seriesId: 'a_1', sourceId: 'a', kind: 'empty' }]);
  });

  it('a failure is kept with its message; a later fetch with episodes clears it', () => {
    let s = reduce(initial, ev('a_1', 'failed', { message: 'HTTP 503' }));
    expect(s.issues).toEqual([{ seriesId: 'a_1', sourceId: 'a', kind: 'failed', message: 'HTTP 503' }]);
    s = reduce(s, ev('a_1', 'finished', { counts: { episodes: 3 } }));
    expect(s.issues).toEqual([]);
  });

  it('two sources: one blank, one fine', () => {
    let s: EpisodeFetchState = initial;
    s = reduce(s, { type: 'queued', seriesId: 'a_1', sourceId: 'a' });
    s = reduce(s, { type: 'queued', seriesId: 'b_9', sourceId: 'b' });
    s = reduce(s, ev('b_9', 'finished', { counts: { episodes: 0 } }));
    expect(s.fetching.map((f) => f.seriesId)).toEqual(['a_1']);
    s = reduce(s, ev('a_1', 'finished', { counts: { episodes: 10 } }));
    expect(warningText(s.issues, name)).toBe('Beta sent no episodes');
  });

  it('a provider that never answers becomes a failed issue on timeout, so nothing spins forever', () => {
    let s = reduce(initial, { type: 'queued', seriesId: 'a_1', sourceId: 'a' });
    s = reduce(s, { type: 'timeout' });
    expect(s.fetching).toEqual([]);
    expect(s.issues).toEqual([{ seriesId: 'a_1', sourceId: 'a', kind: 'failed', message: NO_ANSWER_MESSAGE }]);
    s = reduce(s, ev('a_1', 'finished', { counts: { episodes: 4 } })); // it answers after all
    expect(s.issues).toEqual([]);
  });

  it('queued twice counts once; other stages are ignored; reset starts clean', () => {
    let s = reduce(initial, { type: 'queued', seriesId: 'a_1', sourceId: 'a' });
    s = reduce(s, { type: 'queued', seriesId: 'a_1', sourceId: 'a' });
    expect(s.fetching).toHaveLength(1);
    s = reduce(s, { type: 'progress', progress: { sourceId: 'a', stage: 'vod', state: 'failed', message: 'x' } });
    expect(s.issues).toEqual([]);
    expect(reduce(s, { type: 'reset' })).toEqual(initial);
  });

  it('messages: nothing stored shows the failure (or who sent nothing); a stored list gets a short warning', () => {
    const empty = [{ seriesId: 'a_1', sourceId: 'a', kind: 'empty' as const }, { seriesId: 'b_9', sourceId: 'b', kind: 'empty' as const }];
    expect(blockingMessage(empty, name)).toBe('Alpha, Beta sent no episodes');
    const failed = [{ seriesId: 'a_1', sourceId: 'a', kind: 'failed' as const, message: 'HTTP 503' }];
    expect(blockingMessage(failed, name)).toBe('HTTP 503');
    expect(blockingMessage([{ ...failed[0], message: undefined }], name)).toBe("Couldn't load episodes from Alpha");
    expect(warningText([...failed, empty[1]], name)).toBe("Couldn't refresh from Alpha. Beta sent no episodes");
    expect(blockingMessage([], name)).toBeNull();
    expect(warningText([], name)).toBeNull();
  });
});
