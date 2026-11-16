/** Settings > Sync & transfer: what a received setup replaces (it changes only what it carries). */
import type { SetupPreview } from '../types/electron';

export function receivedNote(p: SetupPreview): string {
  const parts = [
    ...(p.sources.length ? ['your sources'] : []),
    ...(p.settings ? ['your settings'] : []),
    ...(p.apiKeys ? ['the API keys it includes'] : []),
  ];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? 'nothing';
  return `Replaces ${list}. Everything else stays, including favorites, watchlist and watch progress.`;
}
