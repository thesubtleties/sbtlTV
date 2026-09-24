import type { Channel } from './types';
import type { EpgMapping } from './epg-types';

export interface EpgLinkInput { stream_id: string; epg_channel_id: string; confidence: string; strategy: string }

// One link per stream: the matcher's answer if it has one, else the provider's
// own epg_channel_id when the guide actually contains that channel.
export function buildEpgLinks(channels: Channel[], mappings: EpgMapping[], xmltvChannelIds: Set<string>): EpgLinkInput[] {
  const byStream = new Map<string, EpgMapping>();
  for (const m of mappings) byStream.set(m.stream_id, m);
  const links: EpgLinkInput[] = [];
  for (const ch of channels) {
    const m = byStream.get(ch.stream_id);
    if (m) {
      links.push({ stream_id: ch.stream_id, epg_channel_id: m.xmltv_channel_id, confidence: m.confidence, strategy: m.strategy });
    } else if (ch.epg_channel_id && xmltvChannelIds.has(ch.epg_channel_id)) {
      links.push({ stream_id: ch.stream_id, epg_channel_id: ch.epg_channel_id, confidence: 'exact', strategy: 'exact_id' });
    }
  }
  return links;
}
