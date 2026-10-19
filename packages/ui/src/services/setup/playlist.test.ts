import { describe, it, expect } from 'vitest';
import { parseM3U } from '@sbtltv/local-adapter';
import { buildM3U } from './playlist';

const original = `#EXTM3U url-tvg="https://epg.example/guide.xml"
#EXTINF:-1 tvg-id="cbs.us" tvg-logo="https://img.example/cbs.png" tvg-chno="2" group-title="News",CBS
http://stream.example/10
#EXTINF:-1 tvg-id="abc.us" group-title="News",ABC
http://stream.example/11
#EXTINF:-1 tvg-id="abc.us" group-title="Sports",ABC
http://stream.example/11
#EXTINF:-1 tvg-name="No Comma Name",
http://stream.example/12
`;

describe('buildM3U', () => {
  it('rebuilds a playlist that parses to the same channels, ids and groups', () => {
    const before = parseM3U(original, 'src1');
    // What playlistRows returns for it: one row per channel and group
    const rows = before.channels.flatMap((ch) => {
      const groups = ch.category_ids.map((id) => before.categories.find((c) => c.category_id === id)!.category_name);
      return (groups.length ? groups : [null]).map((group_name) => ({
        name: ch.name, stream_icon: ch.stream_icon || null, epg_channel_id: ch.epg_channel_id || null,
        channel_num: ch.channel_num ?? null, direct_url: ch.direct_url!, group_name,
      }));
    });
    const after = parseM3U(buildM3U(rows, 'https://epg.example/guide.xml'), 'src1');
    expect(after.channels.map((c) => [c.stream_id, c.name, c.stream_icon, c.epg_channel_id, c.channel_num, [...c.category_ids].sort()]))
      .toEqual(before.channels.map((c) => [c.stream_id, c.name, c.stream_icon, c.epg_channel_id, c.channel_num, [...c.category_ids].sort()]));
    expect(after.epgUrl).toBe('https://epg.example/guide.xml');
  });

  it('keeps quotes and newlines out of attributes', () => {
    const text = buildM3U([{ name: 'Bad\nName', stream_icon: 'x"y', epg_channel_id: null, channel_num: null, direct_url: 'http://s/1', group_name: 'G"1' }]);
    expect(text.split('\n').filter((l) => l.startsWith('#EXTINF'))).toHaveLength(1);
    expect(text).not.toContain('x"y');
  });
});

describe('R8 buildM3U', () => {
  const row = (o: object) => ({ name: 'A', stream_icon: null, epg_channel_id: null, channel_num: null, direct_url: 'http://s/1', group_name: null, ...o });
  it('a quote in a group name is dropped, not left to cut the group short', () => {
    expect(parseM3U(buildM3U([row({ group_name: 'G"1' })]), 's').categories.map((c) => c.category_name)).toEqual(['G1']);
  });
  it('channel number 0 survives', () => {
    expect(parseM3U(buildM3U([row({ channel_num: 0 })]), 's').channels[0].channel_num).toBe(0);
  });
  it('a name from tvg-name with a comma or edge spaces keeps its stream id (favorites)', () => {
    const before = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="Fox, News",\nhttp://s/1\n#EXTINF:-1 tvg-name=" Padded ",\nhttp://s/2\n', 's').channels;
    const after = parseM3U(buildM3U(before.map((c) => row({ name: c.name, direct_url: c.direct_url }))), 's').channels;
    expect(after.map((c) => [c.stream_id, c.name])).toEqual(before.map((c) => [c.stream_id, c.name]));
  });
});
