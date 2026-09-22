import { describe, it, expect } from 'vitest';
import { buildEpgLinks } from './epg-links';
import type { Channel } from './types';
import type { EpgMapping } from './epg-types';

const ch = (stream_id: string, epg_channel_id: string): Channel => ({ stream_id, epg_channel_id, name: stream_id, stream_icon: '', category_ids: [], direct_url: '', source_id: 's1' });

describe('buildEpgLinks', () => {
  it('links a stream to its matched XMLTV channel', () => {
    const mappings: EpgMapping[] = [{ id: 's1::e::a', source_id: 's1', epg_channel_id: 'x', xmltv_channel_id: 'cbs.us', epg_source: 'e', stream_id: 'a', confidence: 'high', strategy: 'display_name' }];
    expect(buildEpgLinks([ch('a', 'x')], mappings, new Set(['cbs.us']))).toEqual([
      { stream_id: 'a', epg_channel_id: 'cbs.us', confidence: 'high', strategy: 'display_name' },
    ]);
  });

  it('falls back to the provider epg_channel_id when it exists in the guide', () => {
    expect(buildEpgLinks([ch('b', 'abc.us')], [], new Set(['abc.us']))).toEqual([
      { stream_id: 'b', epg_channel_id: 'abc.us', confidence: 'exact', strategy: 'exact_id' },
    ]);
  });

  it('produces no link when neither the matcher nor the id fallback applies', () => {
    expect(buildEpgLinks([ch('c', 'nothing')], [], new Set(['abc.us']))).toEqual([]);
  });

  it('prefers the matcher over the id fallback for the same stream', () => {
    const mappings: EpgMapping[] = [{ id: 'm', source_id: 's1', epg_channel_id: 'abc.us', xmltv_channel_id: 'abc-hd.us', epg_source: 'e', stream_id: 'd', confidence: 'exact', strategy: 'exact_id' }];
    expect(buildEpgLinks([ch('d', 'abc.us')], mappings, new Set(['abc.us', 'abc-hd.us']))).toEqual([
      { stream_id: 'd', epg_channel_id: 'abc-hd.us', confidence: 'exact', strategy: 'exact_id' },
    ]);
  });
});
