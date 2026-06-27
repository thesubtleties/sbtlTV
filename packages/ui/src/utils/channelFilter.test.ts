import { describe, it, expect } from 'vitest';
import { filterChannelsByName } from './channelFilter';
import type { StoredChannel } from '../db';

const ch = (name: string): StoredChannel => ({ name } as StoredChannel);

describe('filterChannelsByName', () => {
  const channels = [ch('BBC One'), ch('CNN'), ch('bbc news'), ch('ESPN')];

  it('returns the SAME array reference for an empty/whitespace query', () => {
    expect(filterChannelsByName(channels, '')).toBe(channels);
    expect(filterChannelsByName(channels, '   ')).toBe(channels);
  });

  it('matches case-insensitive substrings', () => {
    expect(filterChannelsByName(channels, 'bbc').map((c) => c.name)).toEqual(['BBC One', 'bbc news']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterChannelsByName(channels, 'xyz')).toEqual([]);
  });
});
