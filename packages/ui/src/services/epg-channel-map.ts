import type { Channel } from '@sbtltv/core';
import type { XmltvProgram } from '@sbtltv/local-adapter';
import type { EpgMapping, StoredProgram } from '../db/index';

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

  // Add matcher results first; the exact-id fallback below adds to the same set
  // via Set.add (never replacing), so a stream can be reached through either path.
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

/**
 * Expand one XMLTV programme into a stored record for every stream that the
 * programme's channel feeds. Returns an empty array when nothing matches, so
 * the caller can treat that as "unmatched EPG channel".
 */
export function expandProgramToStreams(
  prog: XmltvProgram,
  streamIds: Set<string> | undefined,
  sourceId: string,
): StoredProgram[] {
  if (!streamIds?.size) return [];

  const startMs = prog.start.getTime();
  return [...streamIds].map((streamId) => ({
    id: `${sourceId}-${streamId}-${startMs}`,
    stream_id: streamId,
    title: prog.title,
    description: prog.description,
    start: prog.start,
    end: prog.stop,
    source_id: sourceId,
  }));
}

export interface FanOutSummary {
  multiStreamChannels: number;  // XMLTV channels feeding more than one stream
  maxFanOut: number;            // widest single fan-out
  maxFanOutChannelId: string | null;
  totalStreamLinks: number;     // sum of fan-out widths across all XMLTV channels (storage multiplier)
}

/**
 * Describe how wide the one-to-many fan-out is for this sync.
 *
 * Every extra stream behind an XMLTV channel multiplies the rows written to
 * the programs table. A provider shipping a junk or over-shared epg_channel_id
 * can therefore balloon storage, so we surface the shape in the debug log
 * instead of failing silently.
 */
export function summarizeFanOut(channelMap: Map<string, Set<string>>): FanOutSummary {
  let multiStreamChannels = 0;
  let maxFanOut = 0;
  let maxFanOutChannelId: string | null = null;
  let totalStreamLinks = 0;

  for (const [xmltvChannelId, streamIds] of channelMap) {
    const fanOut = streamIds.size;
    totalStreamLinks += fanOut;
    if (fanOut > 1) multiStreamChannels++;
    if (fanOut > maxFanOut) {
      maxFanOut = fanOut;
      maxFanOutChannelId = xmltvChannelId;
    }
  }

  return { multiStreamChannels, maxFanOut, maxFanOutChannelId, totalStreamLinks };
}
