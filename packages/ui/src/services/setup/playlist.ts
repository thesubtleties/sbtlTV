import type { PlaylistRow } from '@sbtltv/core';

// Attribute values cannot hold quotes or line breaks; the parser reads up to the next quote.
const attr = (v: string) => v.replace(/["\r\n]/g, '');
// The parser takes the display name after the last comma on one line.
const title = (v: string) => v.replace(/[\r\n]/g, ' ').replace(/,/g, ' ');

/**
 * A playlist from a file-based source's stored channels (setup export). Parsing
 * it gives the same stream ids (name + url), so favorites keep working.
 */
export function buildM3U(rows: PlaylistRow[], epgUrl?: string): string {
  const lines = [epgUrl ? `#EXTM3U url-tvg="${attr(epgUrl)}"` : '#EXTM3U'];
  for (const r of rows) {
    const parts = ['#EXTINF:-1'];
    if (r.epg_channel_id) parts.push(`tvg-id="${attr(r.epg_channel_id)}"`);
    if (r.stream_icon) parts.push(`tvg-logo="${attr(r.stream_icon)}"`);
    if (r.channel_num != null) parts.push(`tvg-chno="${r.channel_num}"`);
    if (r.group_name) parts.push(`group-title="${attr(r.group_name)}"`);
    lines.push(`${parts.join(' ')},${title(r.name)}`, r.direct_url.replace(/[\r\n]/g, ''));
  }
  return lines.join('\n') + '\n';
}
