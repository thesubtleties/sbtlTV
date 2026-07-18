import type { Channel } from '@sbtltv/core';
import type { EpgMapping } from '../db/index';

/**
 * Build an XMLTV channel ID -> provider stream IDs lookup.
 *
 * Providers commonly expose several variants of the same channel (HD, FHD,
 * HEVC, backup, and so on). Every variant must receive the shared XMLTV
 * schedule, so the lookup is deliberately one-to-many.
 */
export function buildChannelMap(
  channels: Channel[],
  mappings: EpgMapping[],
): Map<string, Set<string>> {
  const channelMap = new Map<string, Set<string>>();

  const addStream = (xmltvChannelId: string, streamId: string) => {
    let streamIds = channelMap.get(xmltvChannelId);
    if (!streamIds) {
      streamIds = new Set<string>();
      channelMap.set(xmltvChannelId, streamIds);
    }
    streamIds.add(streamId);
  };

  // Matcher results take priority, but do not overwrite sibling variants.
  for (const mapping of mappings) {
    addStream(mapping.xmltv_channel_id, mapping.stream_id);
  }

  // Also include provider-supplied exact IDs as a fallback. Adding all exact
  // channels is intentional: multiple streams can share the same EPG ID.
  for (const channel of channels) {
    if (channel.epg_channel_id) {
      addStream(channel.epg_channel_id, channel.stream_id);
    }
  }

  return channelMap;
}
