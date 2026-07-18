import { describe, expect, it } from 'vitest';
import type { Channel } from '@sbtltv/core';
import type { EpgMapping } from '../db/index';
import { buildChannelMap } from './epg-channel-map';

function channel(streamId: string, epgChannelId: string): Channel {
  return {
    stream_id: streamId,
    name: streamId,
    stream_icon: '',
    epg_channel_id: epgChannelId,
    category_ids: [],
    direct_url: `https://example.test/${streamId}`,
    source_id: 'source',
  };
}

function mapping(streamId: string, xmltvChannelId: string): EpgMapping {
  return {
    id: `source::epg::${streamId}`,
    source_id: 'source',
    epg_channel_id: 'shared.provider.id',
    xmltv_channel_id: xmltvChannelId,
    epg_source: 'epg',
    stream_id: streamId,
    confidence: 'exact',
    strategy: 'exact_id',
  };
}

describe('buildChannelMap', () => {
  it('keeps every stream that maps to the same XMLTV channel', () => {
    const channels = [
      channel('sports-hd', 'sports.example'),
      channel('sports-fhd', 'sports.example'),
      channel('sports-hevc', 'sports.example'),
    ];
    const mappings = channels.map((item) => mapping(item.stream_id, 'sports.example'));

    expect([...buildChannelMap(channels, mappings).get('sports.example')!]).toEqual([
      'sports-hd',
      'sports-fhd',
      'sports-hevc',
    ]);
  });

  it('fans out duplicate provider IDs through the exact fallback', () => {
    const channels = [
      channel('news-hd', 'news.example'),
      channel('news-backup', 'news.example'),
    ];

    expect([...buildChannelMap(channels, []).get('news.example')!]).toEqual([
      'news-hd',
      'news-backup',
    ]);
  });

  it('does not duplicate a stream present in both matching and fallback paths', () => {
    const channels = [channel('movies-hd', 'movies.example')];

    expect(buildChannelMap(channels, [mapping('movies-hd', 'movies.example')]).get('movies.example')?.size).toBe(1);
  });
});
