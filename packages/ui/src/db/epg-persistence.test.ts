import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Channel } from '@sbtltv/core';
import type { XmltvChannel, XmltvProgram } from '@sbtltv/local-adapter';
import { db } from './index';
import { matchChannelsToEpg } from '../services/epg-matcher';
import { buildChannelMap, expandProgramToStreams } from '../services/epg-channel-map';

// End-to-end persistence checks for the #87 fix. The pure helpers verify the
// fan-out in memory; these verify the rows actually land in Dexie as N distinct
// records rather than collapsing on a shared primary key (the original bug).

const SOURCE = 'src-1';
const EPG = 'https://example.test/epg.xml';

function channel(streamId: string, epgChannelId: string): Channel {
  return {
    stream_id: streamId,
    name: streamId,
    stream_icon: '',
    epg_channel_id: epgChannelId,
    category_ids: [],
    direct_url: `https://example.test/${streamId}`,
    source_id: SOURCE,
  };
}

function xmltvChannel(id: string): XmltvChannel {
  return { id, displayNames: [id] };
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

beforeEach(async () => {
  await db.epgMappings.clear();
  await db.programs.clear();
});

describe('#87 EPG mapping persistence', () => {
  it('persists one mapping row per stream variant sharing an epg_channel_id', async () => {
    const channels = [
      channel('sports-hd', 'sports.example'),
      channel('sports-fhd', 'sports.example'),
      channel('sports-hevc', 'sports.example'),
    ];
    const mappings = matchChannelsToEpg(channels, [xmltvChannel('sports.example')], SOURCE, EPG);

    await db.epgMappings.bulkPut(mappings);

    // Old id format keyed on epg_channel_id collapsed all three onto one row here.
    expect(await db.epgMappings.count()).toBe(3);
    const stored = await db.epgMappings.where('source_id').equals(SOURCE).toArray();
    expect(new Set(stored.map((m) => m.stream_id))).toEqual(
      new Set(['sports-hd', 'sports-fhd', 'sports-hevc']),
    );
  });
});

describe('#87 EPG program persistence', () => {
  it('writes a program row for every variant so each channel shows the guide', async () => {
    const channels = [
      channel('sports-hd', 'sports.example'),
      channel('sports-fhd', 'sports.example'),
      channel('sports-hevc', 'sports.example'),
    ];
    const mappings = matchChannelsToEpg(channels, [xmltvChannel('sports.example')], SOURCE, EPG);
    const channelMap = buildChannelMap(channels, mappings);

    const prog = program('sports.example', 1_700_000_000_000);
    const records = expandProgramToStreams(prog, channelMap.get(prog.channel_id), SOURCE);
    await db.programs.bulkPut(records);

    expect(await db.programs.count()).toBe(3);
    // Each variant can be read back on its own stream_id (the EPG grid keys on it).
    for (const streamId of ['sports-hd', 'sports-fhd', 'sports-hevc']) {
      const row = await db.programs.where('stream_id').equals(streamId).first();
      expect(row?.title).toBe('Match of the Day');
    }
  });
});
