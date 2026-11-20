import { describe, expect, it } from 'vitest';
import { receivedNote } from './receivedNote';

const preview = (o: { sources?: number; settings?: boolean; apiKeys?: string[] }) => ({
  app: '0.17.0', exportedAt: '', platform: 'linux',
  sources: Array.from({ length: o.sources ?? 0 }, () => ({ name: 'x', type: 'xtream', withLogin: true, fromFile: false, host: 'h' })),
  settings: !!o.settings, apiKeys: o.apiKeys ?? [], favorites: 0, watchlist: 0, progress: 0,
});

describe('receivedNote', () => {
  it('names what the setup replaces, then what it leaves alone', () => {
    expect(receivedNote(preview({ sources: 2 }))).toBe("Replaces your sources. Doesn't change your settings, favorites, watchlist or watch progress.");
    expect(receivedNote(preview({ sources: 1, settings: true, apiKeys: ['TMDB', 'RatingPosterDB', 'SubDL'] })))
      .toBe("Replaces your sources, your settings and your TMDB, RatingPosterDB and SubDL keys. Doesn't change your favorites, watchlist or watch progress.");
    expect(receivedNote(preview({ apiKeys: ['TMDB'] }))).toBe("Replaces your TMDB key. Doesn't change your sources, settings, favorites, watchlist or watch progress.");
    expect(receivedNote(preview({ apiKeys: ['TMDB', 'SubDL'] }))).toBe("Replaces your TMDB and SubDL keys. Doesn't change your sources, settings, favorites, watchlist or watch progress.");
  });
});
