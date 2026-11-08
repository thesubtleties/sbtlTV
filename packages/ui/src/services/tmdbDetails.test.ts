import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMovieDetails = vi.fn();
const getTvShowDetails = vi.fn();
const getMovieCredits = vi.fn();
const getTvShowCredits = vi.fn();
vi.mock('./tmdb', () => ({ getMovieDetails, getTvShowDetails, getMovieCredits, getTvShowCredits }));

const { tmdbDetails, tmdbCredits, resetTmdbDetailsForTests } = await import('./tmdbDetails');

describe('shared TMDB details', () => {
  beforeEach(() => {
    resetTmdbDetailsForTests();
    for (const f of [getMovieDetails, getTvShowDetails, getMovieCredits, getTvShowCredits]) f.mockReset();
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
});
