import { describe, expect, it } from 'vitest';
import { receivedNote } from './receivedNote';

const preview = (o: { sources?: number; settings?: boolean; apiKeys?: boolean }) => ({
  app: '0.17.0', exportedAt: '', platform: 'linux',
  sources: Array.from({ length: o.sources ?? 0 }, () => ({ name: 'x', type: 'xtream', withLogin: true, fromFile: false, host: 'h' })),
  settings: !!o.settings, apiKeys: !!o.apiKeys, favorites: 0, watchlist: 0, progress: 0,
});

describe('receivedNote', () => {
  it('names only what the setup replaces, and what stays', () => {
    expect(receivedNote(preview({ sources: 2 }))).toBe('Replaces your sources. Everything else stays, including favorites, watchlist and watch progress.');
    expect(receivedNote(preview({ sources: 1, settings: true, apiKeys: true }))).toBe('Replaces your sources, your settings and the API keys it includes. Everything else stays, including favorites, watchlist and watch progress.');
    expect(receivedNote(preview({ apiKeys: true }))).toBe('Replaces the API keys it includes. Everything else stays, including favorites, watchlist and watch progress.');
  });
});
