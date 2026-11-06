// Guide search rules (pure, used by the data process and the renderer).

export interface GuideSearchRow {
  id: string; title: string; description: string; start: number; end: number; rank: number;
  stream_id: string; channel_name: string; stream_icon: string;
}
export interface GuideSearchChannel { stream_id: string; name: string; stream_icon: string }
export interface GuideAiring {
  key: string; title: string; description: string; startMs: number; endMs: number;
  channels: GuideSearchChannel[]; programIds: string[];
}
export interface GuideSearchResult {
  channels: GuideSearchChannel[];
  channelTotal: number;
  onNow: GuideAiring[];
  later: GuideAiring[];
  mentions: GuideAiring[];
}

export const GUIDE_SEARCH_MIN_CHARS = 2;

const fold = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const wordsOf = (t: string) => t.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The FTS5 query for what was typed: quoted prefixes, so nothing typed is ever syntax. */
export function toFtsQuery(query: string): string | null {
  const words = wordsOf(query.toLowerCase());
  if (words.join('').length < GUIDE_SEARCH_MIN_CHARS) return null;
  return words.map((w) => `"${w}"*`).join(' ');
}

export function isTitleMatch(title: string, query: string): boolean {
  const inTitle = wordsOf(fold(title));
  return wordsOf(fold(query)).every((w) => inTitle.some((t) => t.startsWith(w)));
}

/** By name, because providers rarely set is_adult. Best effort: "Adult Swim" is not. */
export function isAdultCategoryName(name: string): boolean {
  if (/\badult swim\b/i.test(name)) return false;
  return /\b(adults?|xxx)\b/i.test(name) || name.includes('18+');
}

export function isAiringLive(airing: { startMs: number }, nowMs: number): boolean {
  return airing.startMs <= nowMs;
}

export function groupAirings(rows: GuideSearchRow[], query: string, nowMs: number): Pick<GuideSearchResult, 'onNow' | 'later' | 'mentions'> {
  const groups = new Map<string, GuideAiring & { rank: number; titleHit: boolean }>();
  for (const r of rows) {
    const key = `${r.title}|${r.start}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, title: r.title, description: r.description, startMs: r.start, endMs: r.end, channels: [], programIds: [], rank: r.rank, titleHit: isTitleMatch(r.title, query) };
      groups.set(key, g);
    }
    g.rank = Math.min(g.rank, r.rank);
    if (!g.channels.some((c) => c.stream_id === r.stream_id)) g.channels.push({ stream_id: r.stream_id, name: r.channel_name, stream_icon: r.stream_icon });
    g.programIds.push(r.id);
  }
  const all = [...groups.values()];
  const clean = (list: typeof all): GuideAiring[] => list.map(({ rank: _rank, titleHit: _hit, ...a }) => a);
  const hits = all.filter((g) => g.titleHit);
  const mentions = all.filter((g) => !g.titleHit);
  const live = (g: GuideAiring) => isAiringLive(g, nowMs);
  return {
    onNow: clean(hits.filter(live).sort((a, b) => a.rank - b.rank)),
    later: clean(hits.filter((g) => !live(g)).sort((a, b) => a.startMs - b.startMs)),
    mentions: clean(mentions.sort((a, b) => Number(live(b)) - Number(live(a)) || a.startMs - b.startMs)),
  };
}
