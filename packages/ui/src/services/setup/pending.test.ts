import { describe, it, expect } from 'vitest';
import { resumePendingPlaylists } from './pending';

const p = (sourceId: string) => ({ sourceId, content: '#EXTM3U\n#EXTINF:-1,One\nhttp://s/1\n' });

describe('resumePendingPlaylists', () => {
  it('imports playlists whose source has no channels yet, and keeps them pending until it does', async () => {
    const imported: string[] = [];
    const counts: Record<string, number> = { a: 0, b: 5 };
    const done = await resumePendingPlaylists([p('a'), p('b'), p('gone')], new Set(['a', 'b']),
      async (id) => counts[id] ?? 0, async (x) => { imported.push(x.sourceId); });
    expect(imported).toEqual(['a']);
    // b already has its channels; gone is no longer a source: both settled. a stays until its channels land.
    expect(done.sort()).toEqual(['b', 'gone']);
  });

  it('a failed import stays pending for the next start', async () => {
    const done = await resumePendingPlaylists([p('a')], new Set(['a']), async () => 0, async () => { throw new Error('worker down'); });
    expect(done).toEqual([]);
  });

  it('a playlist with no channels in it settles at once instead of being imported on every start', async () => {
    const imported: string[] = [];
    const done = await resumePendingPlaylists([{ sourceId: 'a', content: '#EXTM3U\n' }], new Set(['a']), async () => 0, async (x) => { imported.push(x.sourceId); });
    expect(done).toEqual(['a']);
    expect(imported).toEqual([]);
  });
});
