import { describe, expect, it } from 'vitest';
import type { Channel } from '@sbtltv/core';
import { matchChannelsToEpg } from './epg-matcher';

function channel(streamId: string): Channel {
  return {
    stream_id: streamId,
    name: `Sports ${streamId}`,
    stream_icon: '',
    epg_channel_id: 'sports.example',
    category_ids: [],
    direct_url: `https://example.test/${streamId}`,
    source_id: 'source',
  };
}

describe('matchChannelsToEpg mapping identity', () => {
  it('persists separate mappings for stream variants sharing an EPG ID', () => {
    const mappings = matchChannelsToEpg(
      [channel('hd'), channel('fhd'), channel('hevc')],
      [{ id: 'sports.example', displayNames: ['Sports'] }],
      'source',
      'https://example.test/epg.xml',
    );

    expect(mappings).toHaveLength(3);
    expect(new Set(mappings.map((mapping) => mapping.id)).size).toBe(3);
    expect(mappings.map((mapping) => mapping.stream_id)).toEqual(['hd', 'fhd', 'hevc']);
  });
});
