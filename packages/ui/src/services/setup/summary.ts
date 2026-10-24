import type { SetupPreview } from '../../types/electron';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// An M3U carries its login in its addresses; an Xtream source shared without its
// password needs it entered after importing.
function sourceLine(s: SetupPreview['sources'][number]): string {
  const where = s.host ? `${s.name} at ${s.host}` : s.fromFile ? `${s.name}, from a file` : s.name;
  if (s.type === 'm3u') return `${where}, M3U: login is part of the playlist`;
  if (s.type === 'xtream') return s.withLogin ? `${where}, with login` : `${where}, password needed after importing`;
  return where;
}

/** What a setup file holds, in one line for the import preview. */
export function setupSummary(p: SetupPreview): string {
  const parts: string[] = [];
  if (p.sources.length) parts.push(`${count(p.sources.length, 'source', 'sources')} (${p.sources.map(sourceLine).join('; ')})`);
  if (p.settings) parts.push('settings');
  if (p.apiKeys) parts.push('API keys');
  if (p.favorites) parts.push(count(p.favorites, 'favorite', 'favorites'));
  if (p.watchlist) parts.push(count(p.watchlist, 'watchlist item', 'watchlist items'));
  if (p.progress) parts.push(`watch progress for ${count(p.progress, 'title', 'titles')}`);
  return parts.join(', ') || 'nothing';
}
