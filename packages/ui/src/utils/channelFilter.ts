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
  return channels.filter((ch) => ch.name.toLowerCase().includes(q));
}
