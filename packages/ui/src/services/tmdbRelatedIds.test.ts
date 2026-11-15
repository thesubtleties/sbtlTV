import { describe, it, expect, vi, beforeEach } from 'vitest';

const movies = { recommendations: vi.fn(), similar: vi.fn() };
const tvShows = { recommendations: vi.fn(), similar: vi.fn() };
vi.mock('tmdb-ts', () => ({ TMDB: class { movies = movies; tvShows = tvShows; } }));

const { getRelatedIds, relatedIdsFrom } = await import('./tmdb');
const { resetTmdbKeyHealth, REJECTIONS_TO_STOP } = await import('./tmdbKeyHealth');

describe('TMDB related ids', () => {
  beforeEach(() => { for (const f of [movies.recommendations, movies.similar, tvShows.recommendations, tvShows.similar]) f.mockReset(); });

  it('movies and series use their own endpoint, recommendations and similar their own call, ids in TMDB order', async () => {
    movies.recommendations.mockResolvedValue({ results: [{ id: 3 }, { id: 1 }, { id: 2 }] });
    tvShows.similar.mockResolvedValue({ results: [{ id: 9 }] });
    await expect(getRelatedIds('k', 'movie', 5, 'recommendations')).resolves.toEqual([3, 1, 2]);
    await expect(getRelatedIds('k', 'series', 7, 'similar')).resolves.toEqual([9]);
    expect(movies.recommendations).toHaveBeenCalledWith(5);
    expect(tvShows.similar).toHaveBeenCalledWith(7);
    expect(movies.similar).not.toHaveBeenCalled();
    expect(tvShows.recommendations).not.toHaveBeenCalled();
  });

  it('a page without results is no ids', async () => {
    tvShows.recommendations.mockResolvedValue({});
    await expect(getRelatedIds('k', 'series', 7, 'recommendations')).resolves.toEqual([]);
  });

  it('keeps positive integer ids only, at most 40', () => {
    expect(relatedIdsFrom([{ id: 1 }, { id: null }, { id: '2' }, null, { id: -3 }, { id: 4.5 }, { id: 5 }])).toEqual([1, 5]);
    expect(relatedIdsFrom({ id: 1 })).toEqual([]);
    expect(relatedIdsFrom(Array.from({ length: 60 }, (_, i) => ({ id: i + 1 })))).toHaveLength(40);
  });

  it('after repeated key refusals, calls fail at once without reaching TMDB; a new key resumes', async () => {
    resetTmdbKeyHealth();
    movies.recommendations.mockRejectedValue({ status_code: 7, status_message: 'Invalid API key' });
    for (let i = 0; i < REJECTIONS_TO_STOP; i++) await expect(getRelatedIds('bad', 'movie', i + 1, 'recommendations')).rejects.toBeTruthy();
    expect(movies.recommendations).toHaveBeenCalledTimes(REJECTIONS_TO_STOP);
    await expect(getRelatedIds('bad', 'movie', 99, 'recommendations')).rejects.toThrow(/set aside/);
    expect(movies.recommendations).toHaveBeenCalledTimes(REJECTIONS_TO_STOP);
    movies.recommendations.mockResolvedValue({ results: [{ id: 1 }] });
    await expect(getRelatedIds('good', 'movie', 99, 'recommendations')).resolves.toEqual([1]);
  });
});
