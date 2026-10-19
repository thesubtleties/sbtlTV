import { describe, it, expect } from 'vitest';
import { setupSummary } from './summary';

const base = { app: '0.13.1', exportedAt: '2026-10-19T12:00:00Z', platform: 'linux', settings: false, apiKeys: false, favorites: 0, watchlist: 0, progress: 0 };

describe('setupSummary', () => {
  it('counts in words that read right for one and many', () => {
    expect(setupSummary({ ...base, sources: [{ name: 'A', type: 'xtream', withLogin: true, fromFile: false }], favorites: 1, watchlist: 1, progress: 1 }))
      .toBe('1 source (A with login), 1 favorite, 1 watchlist item, watch progress for 1 title');
    expect(setupSummary({ ...base, sources: [], settings: true, apiKeys: true, favorites: 12, watchlist: 8, progress: 3 }))
      .toBe('settings, API keys, 12 favorites, 8 watchlist items, watch progress for 3 titles');
    expect(setupSummary({ ...base, sources: [] })).toBe('nothing');
  });

  it("says which sources need their password, and that an M3U's login is part of its playlist", () => {
    expect(setupSummary({ ...base, sources: [
      { name: 'Provider', type: 'xtream', withLogin: false, fromFile: false },
      { name: 'Family', type: 'm3u', withLogin: false, fromFile: false },
      { name: 'Local', type: 'm3u', withLogin: false, fromFile: true },
    ] })).toBe('3 sources (Provider, password needed after importing; Family, M3U: login is part of the playlist; Local, M3U: login is part of the playlist)');
  });
});
