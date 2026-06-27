import type { StoredChannel } from '../db';

/**
 * Filter channels by a case-insensitive substring of the channel name.
 *
 * Returns the original array BY IDENTITY when the query is empty/whitespace, so the channel
 * list (Virtuoso `data`) doesn't see a new array reference on every keystroke-free render.
 */
export function filterChannelsByName(channels: StoredChannel[], query: string): StoredChannel[] {
  const q = query.trim().toLowerCase();
  if (!q) return channels;
  // Guard the name: a channel with a null/undefined name from bad provider data must not crash
  // the whole panel (this runs inside a useMemo in ChannelPanel).
  return channels.filter((ch) => (ch.name ?? '').toLowerCase().includes(q));
}
