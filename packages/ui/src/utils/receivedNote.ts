/** Settings > Sync & transfer: what a received setup replaces (it changes only what it carries). */
import type { SetupPreview } from '../types/electron';

const join = (items: string[], last: 'and' | 'or') =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}` : items[0] ?? '';

export function receivedNote(p: SetupPreview): string {
  const keys = p.apiKeys.length ? [`your ${join(p.apiKeys, 'and')} ${p.apiKeys.length > 1 ? 'keys' : 'key'}`] : [];
  const replaced = [...(p.sources.length ? ['your sources'] : []), ...(p.settings ? ['your settings'] : []), ...keys];
  const kept = [...(p.sources.length ? [] : ['sources']), ...(p.settings ? [] : ['settings']), 'favorites', 'watchlist', 'watch progress'];
  return `${replaced.length ? `Replaces ${join(replaced, 'and')}. ` : ''}Doesn't change your ${join(kept, 'or')}.`;
}
