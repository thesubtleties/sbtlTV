import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createHoverPrefetch,
  DETAILS_DWELL_MS,
  EPISODES_DWELL_MS,
  EPISODES_RETRY_AFTER_MS,
  type PrefetchTarget,
  prefetchTargetFor,
} from './hoverPrefetch';

function setup() {
  const calls: string[] = [];
  const deps = {
    details: vi.fn(async (_k: string, kind: string, id: number) => { calls.push(`details ${kind} ${id}`); return { backdrop_path: '/fetched.jpg' }; }),
    credits: vi.fn(async (_k: string, kind: string, id: number) => { calls.push(`credits ${kind} ${id}`); return {}; }),
    episodes: vi.fn(async (sid: string) => { calls.push(`episodes ${sid}`); return {}; }),
    preload: vi.fn((url: string) => { calls.push(`preload ${url}`); }),
    now: () => Date.now(),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  return { calls, deps, prefetch: createHoverPrefetch(deps) };
}

const series = (over: Partial<PrefetchTarget> = {}): PrefetchTarget => ({
  kind: 'series', tmdbId: 1399, seriesId: 's1_sr1', apiKey: 'key',
  needsDetails: true, needsCredits: true,
  backdropUrl: (p) => (p ? `img${p}` : null),
  ...over,
});

describe('hover prefetch', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('waits for the dwell, then fetches details + credits, preloads the backdrop, then episodes', async () => {
    const { calls, prefetch } = setup();
    prefetch.enter(series());
    await vi.advanceTimersByTimeAsync(DETAILS_DWELL_MS - 1);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(['details series 1399', 'credits series 1399', 'preload img/fetched.jpg']);
    await vi.advanceTimersByTimeAsync(EPISODES_DWELL_MS - DETAILS_DWELL_MS);
    expect(calls[calls.length - 1]).toBe('episodes s1_sr1');
  });

  it('leaving before the dwell cancels everything; passing over cards in a row asks for none', async () => {
    const { calls, prefetch } = setup();
    for (let i = 0; i < 10; i++) {
      prefetch.enter(series({ tmdbId: i, seriesId: `s1_${i}` }));
      await vi.advanceTimersByTimeAsync(DETAILS_DWELL_MS - 50);
    }
    prefetch.leave();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toEqual([]);
  });

  it('leaving between the two dwells keeps the TMDB warm-up but skips the provider', async () => {
    const { deps, prefetch } = setup();
    const t = prefetch.enter(series());
    await vi.advanceTimersByTimeAsync(DETAILS_DWELL_MS + 10);
    prefetch.leave(t);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.details).toHaveBeenCalledTimes(1);
    expect(deps.episodes).not.toHaveBeenCalled();
  });

  it('a stale token from an unmounted card does not cancel the card now hovered', async () => {
    const { deps, prefetch } = setup();
    const old = prefetch.enter(series({ seriesId: 'a' }));
    prefetch.enter(series({ seriesId: 'b' }));
    prefetch.leave(old);
    await vi.advanceTimersByTimeAsync(EPISODES_DWELL_MS);
    expect(deps.episodes).toHaveBeenCalledWith('b');
  });

  it('no TMDB key: no TMDB requests, a stored backdrop still preloads, episodes still warm', async () => {
    const { deps, prefetch } = setup();
    prefetch.enter(series({ apiKey: null, backdropUrl: () => 'img/stored.jpg' }));
    await vi.advanceTimersByTimeAsync(EPISODES_DWELL_MS);
    expect(deps.details).not.toHaveBeenCalled();
    expect(deps.credits).not.toHaveBeenCalled();
    expect(deps.preload).toHaveBeenCalledWith('img/stored.jpg');
    expect(deps.episodes).toHaveBeenCalledWith('s1_sr1');
  });

  it('a row that already has everything costs no TMDB request', async () => {
    const { deps, prefetch } = setup();
    prefetch.enter(series({ kind: 'movie', seriesId: null, needsDetails: false, needsCredits: false, backdropUrl: () => 'img/stored.jpg' }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.details).not.toHaveBeenCalled();
    expect(deps.credits).not.toHaveBeenCalled();
    expect(deps.episodes).not.toHaveBeenCalled(); // movies have no episode list
    expect(deps.preload).toHaveBeenCalledTimes(1);
  });

  it('hovering the same series again soon does not ask the provider again (the data process also skips fresh lists)', async () => {
    const { deps, prefetch } = setup();
    for (let i = 0; i < 3; i++) {
      prefetch.enter(series());
      await vi.advanceTimersByTimeAsync(EPISODES_DWELL_MS);
      prefetch.leave();
    }
    expect(deps.episodes).toHaveBeenCalledTimes(1);
    expect(deps.preload).toHaveBeenCalledTimes(1); // same image once
    await vi.advanceTimersByTimeAsync(EPISODES_RETRY_AFTER_MS);
    prefetch.enter(series());
    await vi.advanceTimersByTimeAsync(EPISODES_DWELL_MS);
    expect(deps.episodes).toHaveBeenCalledTimes(2);
  });

  it('a failed details request still preloads the stored fallback', async () => {
    const { deps, prefetch } = setup();
    deps.details.mockRejectedValueOnce(new Error('offline'));
    prefetch.enter(series({ backdropUrl: (p) => (p ? `img${p}` : 'img/cover.jpg') }));
    await vi.advanceTimersByTimeAsync(DETAILS_DWELL_MS);
    expect(deps.preload).toHaveBeenCalledWith('img/cover.jpg');
  });
});

describe('prefetchTargetFor (mirrors the detail hooks)', () => {
  const series = { series_id: 's1_sr1', source_id: 's1', name: 'Show', cover: '', tmdb_id: 1399, backdrop_path: '/b.jpg', plot: 'p', genre: 'g', cast: 'A, B' } as unknown as Parameters<typeof prefetchTargetFor>[0];
  const movie = { stream_id: 's1_m1', source_id: 's1', name: 'Film', stream_icon: '', direct_url: 'http://x', tmdb_id: 603, backdrop_path: '/m.jpg', plot: 'p', genre: 'g', cast: 'A', director: 'D' } as unknown as Parameters<typeof prefetchTargetFor>[0];
  const noRpdb = { apiKey: null, backdropsEnabled: false };

  it('a complete row needs nothing from TMDB; the stored backdrop is preloaded', () => {
    const t = prefetchTargetFor(series, 'key', noRpdb);
    expect(t).toMatchObject({ kind: 'series', tmdbId: 1399, seriesId: 's1_sr1', apiKey: 'key', needsDetails: false, needsCredits: false });
    expect(t.backdropUrl('/other.jpg')).toContain('/b.jpg');
  });

  it('any of backdrop, plot or genre missing needs details; blank cast or a movie without director needs credits', () => {
    expect(prefetchTargetFor({ ...series, genre: undefined } as typeof series, 'k', noRpdb).needsDetails).toBe(true);
    expect(prefetchTargetFor({ ...series, cast: '  ' } as typeof series, 'k', noRpdb).needsCredits).toBe(true);
    expect(prefetchTargetFor({ ...movie, director: '' } as typeof movie, 'k', noRpdb).needsCredits).toBe(true);
    expect(prefetchTargetFor(movie, 'k', noRpdb)).toMatchObject({ kind: 'movie', seriesId: null, needsCredits: false });
  });

  it('without a stored backdrop the fetched one is used; an empty key is no key', () => {
    const t = prefetchTargetFor({ ...series, backdrop_path: undefined } as typeof series, '', noRpdb);
    expect(t.apiKey).toBeNull();
    expect(t.backdropUrl('/fetched.jpg')).toContain('/fetched.jpg');
    expect(t.backdropUrl(null)).toBeNull();
  });

  it('RPDB backdrops win only with a key, backdrops on and a TMDB id', () => {
    const on = { apiKey: 't2-abc', backdropsEnabled: true }; // tier 2+ keys have backdrops
    expect(prefetchTargetFor(series, 'k', on).backdropUrl(null)).not.toContain('/b.jpg');
    expect(prefetchTargetFor(series, 'k', { ...on, backdropsEnabled: false }).backdropUrl(null)).toContain('/b.jpg');
    expect(prefetchTargetFor({ ...series, tmdb_id: undefined } as typeof series, 'k', on).backdropUrl(null)).toContain('/b.jpg');
  });
});

describe('hover prefetch failures', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a failed episode ask is not repeated within the retry window, and nothing is left unhandled', async () => {
    const { deps, prefetch } = setup();
    deps.episodes.mockRejectedValue(new Error('offline'));
    deps.credits.mockRejectedValue(new Error('429'));
    prefetch.enter(series());
    await vi.advanceTimersByTimeAsync(EPISODES_DWELL_MS);
    prefetch.leave();
    await vi.advanceTimersByTimeAsync(EPISODES_RETRY_AFTER_MS - EPISODES_DWELL_MS - 1);
    prefetch.enter(series());
    await vi.advanceTimersByTimeAsync(EPISODES_DWELL_MS);
    expect(deps.episodes).toHaveBeenCalledTimes(1);
  });
});
