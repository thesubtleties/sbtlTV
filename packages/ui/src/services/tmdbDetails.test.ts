import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMovieDetails = vi.fn();
const getTvShowDetails = vi.fn();
const getMovieCredits = vi.fn();
const getTvShowCredits = vi.fn();
const getRelatedIds = vi.fn();
vi.mock('./tmdb', () => ({ getMovieDetails, getTvShowDetails, getMovieCredits, getTvShowCredits, getRelatedIds }));

const { tmdbDetails, tmdbCredits, tmdbRelated, resetTmdbDetailsForTests } = await import('./tmdbDetails');

describe('shared TMDB details', () => {
  beforeEach(() => {
    resetTmdbDetailsForTests();
    for (const f of [getMovieDetails, getTvShowDetails, getMovieCredits, getTvShowCredits, getRelatedIds]) f.mockReset();
  });

  it('the backdrop and plot hooks asking at once make one request', async () => {
    getMovieDetails.mockResolvedValue({ id: 1, backdrop_path: '/b.jpg', overview: 'x' });
    const [a, b] = await Promise.all([tmdbDetails('k', 'movie', 1), tmdbDetails('k', 'movie', 1)]);
    expect(a).toBe(b);
    expect(getMovieDetails).toHaveBeenCalledTimes(1);
    await tmdbDetails('k', 'movie', 1); // later: kept
    expect(getMovieDetails).toHaveBeenCalledTimes(1);
  });

  it('movies, series, details and credits are separate entries', async () => {
    getMovieDetails.mockResolvedValue({});
    getTvShowDetails.mockResolvedValue({});
    getMovieCredits.mockResolvedValue({ cast: [], crew: [] });
    await Promise.all([tmdbDetails('k', 'movie', 7), tmdbDetails('k', 'series', 7), tmdbCredits('k', 'movie', 7)]);
    expect(getMovieDetails).toHaveBeenCalledWith('k', 7);
    expect(getTvShowDetails).toHaveBeenCalledWith('k', 7);
    expect(getMovieCredits).toHaveBeenCalledWith('k', 7);
  });

  it('a failure is not kept: the next ask tries again', async () => {
    getTvShowDetails.mockRejectedValueOnce(new Error('429')).mockResolvedValueOnce({ id: 2 });
    await expect(tmdbDetails('k', 'series', 2)).rejects.toThrow('429');
    await expect(tmdbDetails('k', 'series', 2)).resolves.toEqual({ id: 2 });
    expect(getTvShowDetails).toHaveBeenCalledTimes(2);
  });

  it('related ids: the page and a hover share one request; recommendations and similar are separate; failures retry', async () => {
    getRelatedIds.mockImplementation(async (_k: string, _kind: string, _id: number, which: string) => (which === 'recommendations' ? [1, 2] : [3]));
    const [a, b] = await Promise.all([tmdbRelated('k', 'movie', 5, 'recommendations'), tmdbRelated('k', 'movie', 5, 'recommendations')]);
    expect(a).toEqual([1, 2]); expect(b).toBe(a);
    expect(await tmdbRelated('k', 'movie', 5, 'similar')).toEqual([3]);
    expect(getRelatedIds).toHaveBeenCalledTimes(2);
    getRelatedIds.mockRejectedValueOnce(new Error('429'));
    await expect(tmdbRelated('k', 'series', 9, 'recommendations')).rejects.toThrow('429');
    await expect(tmdbRelated('k', 'series', 9, 'recommendations')).resolves.toEqual([1, 2]);
  });

  it('related ids: a movie and a series with the same TMDB id are separate entries, each asked as its own kind', async () => {
    getRelatedIds.mockImplementation(async (_k: string, kind: string) => (kind === 'movie' ? [10] : [20]));
    await expect(tmdbRelated('k', 'movie', 5, 'similar')).resolves.toEqual([10]);
    await expect(tmdbRelated('k', 'series', 5, 'similar')).resolves.toEqual([20]);
    expect(getRelatedIds).toHaveBeenCalledWith('k', 'movie', 5, 'similar');
    expect(getRelatedIds).toHaveBeenCalledWith('k', 'series', 5, 'similar');
  });

  it('the cache is bounded: after many titles the first is asked again, the latest is not', async () => {
    getRelatedIds.mockResolvedValue([]);
    for (let i = 0; i < 1000; i++) await tmdbRelated('k', 'movie', i, 'recommendations');
    getRelatedIds.mockClear();
    await tmdbRelated('k', 'movie', 999, 'recommendations');
    expect(getRelatedIds).not.toHaveBeenCalled();
    await tmdbRelated('k', 'movie', 0, 'recommendations');
    expect(getRelatedIds).toHaveBeenCalledTimes(1);
  });
});

