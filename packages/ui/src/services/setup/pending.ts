export interface PendingPlaylist { sourceId: string; content: string }

/**
 * After a setup import: playlists from files come back from the setup file. One
 * stays pending until its source has channels (an import only queues the work, and
 * closing the app mid-import must not lose it); a source that is gone settles it.
 * Returns the source ids that are settled.
 */
export async function resumePendingPlaylists(
  pending: PendingPlaylist[],
  sourceIds: Set<string>,
  channelCount: (sourceId: string) => Promise<number>,
  importPlaylist: (p: PendingPlaylist) => Promise<void>,
): Promise<string[]> {
  const settled: string[] = [];
  for (const p of pending) {
    // Nothing to bring back (no channel lines), the source is gone, or its channels are in.
    if (!p.content.includes('#EXTINF') || !sourceIds.has(p.sourceId) || (await channelCount(p.sourceId)) > 0) {
      settled.push(p.sourceId);
      continue;
    }
    try {
      await importPlaylist(p);
    } catch {
      // Stays pending: tried again on the next start.
    }
  }
  return settled;
}
