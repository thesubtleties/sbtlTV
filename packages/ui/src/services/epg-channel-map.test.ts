import { describe, expect, it } from 'vitest';
import type { Channel } from '@sbtltv/core';
import type { XmltvProgram } from '@sbtltv/local-adapter';
import type { EpgMapping } from '../db/index';
import { buildChannelMap, expandProgramToStreams, summarizeFanOut } from './epg-channel-map';

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

function program(channelId: string, startMs: number): XmltvProgram {
  return {
    channel_id: channelId,
    title: 'Match of the Day',
    description: 'Highlights',
    start: new Date(startMs),
    stop: new Date(startMs + 3_600_000),
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

  it('ignores channels with a blank provider EPG ID', () => {
    const channelMap = buildChannelMap([channel('no-epg', '')], []);

    expect(channelMap.size).toBe(0);
  });
});

describe('expandProgramToStreams', () => {
  it('creates one record per matching stream with stream-specific IDs', () => {
    const streams = new Set(['sports-hd', 'sports-fhd', 'sports-hevc']);

    const records = expandProgramToStreams(program('sports.example', 1_700_000_000_000), streams, 'source');

    expect(records.map((record) => record.stream_id)).toEqual(['sports-hd', 'sports-fhd', 'sports-hevc']);
    expect(records.map((record) => record.id)).toEqual([
      'source-sports-hd-1700000000000',
      'source-sports-fhd-1700000000000',
      'source-sports-hevc-1700000000000',
    ]);
  });

  it('carries programme metadata across and maps stop to end', () => {
    const prog = program('sports.example', 1_700_000_000_000);

    const [record] = expandProgramToStreams(prog, new Set(['sports-hd']), 'source');

    expect(record).toMatchObject({
      title: 'Match of the Day',
      description: 'Highlights',
      start: prog.start,
      end: prog.stop,
      source_id: 'source',
    });
  });

  it('returns nothing when the XMLTV channel matches no streams', () => {
    expect(expandProgramToStreams(program('orphan.example', 1), undefined, 'source')).toEqual([]);
    expect(expandProgramToStreams(program('orphan.example', 1), new Set(), 'source')).toEqual([]);
  });
});

describe('summarizeFanOut', () => {
  it('reports the widest fan-out and how many channels feed several streams', () => {
    const channelMap = new Map([
      ['sports.example', new Set(['hd', 'fhd', 'hevc'])],
      ['news.example', new Set(['hd', 'backup'])],
      ['movies.example', new Set(['hd'])],
    ]);

    expect(summarizeFanOut(channelMap)).toEqual({
      multiStreamChannels: 2,
      maxFanOut: 3,
      maxFanOutChannelId: 'sports.example',
      totalStreamLinks: 6,
    });
  });

  it('handles an empty channel map', () => {
    expect(summarizeFanOut(new Map())).toEqual({
      multiStreamChannels: 0,
      maxFanOut: 0,
      maxFanOutChannelId: null,
      totalStreamLinks: 0,
    });
  });
});
