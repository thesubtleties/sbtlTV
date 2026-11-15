import { describe, it, expect, vi, beforeEach } from 'vitest';

const movies = { recommendations: vi.fn(), similar: vi.fn() };
const tvShows = { recommendations: vi.fn(), similar: vi.fn() };
vi.mock('tmdb-ts', () => ({ TMDB: class { movies = movies; tvShows = tvShows; } }));

const { getRelatedIds } = await import('./tmdb');

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
});
