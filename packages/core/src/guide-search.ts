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
  const words = wordsOf(fold(query));
  if (!words.some((w) => w.length >= GUIDE_SEARCH_MIN_CHARS)) return null;
  return words.map((w) => `"${w}"*`).join(' ');
}

// So common that even as exact words they are in most descriptions.
const COMMON_SHORT_WORDS = new Set([
  'a', 'an', 'as', 'at', 'be', 'by', 'do', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we',
  'all', 'and', 'are', 'but', 'for', 'had', 'has', 'her', 'his', 'not', 'one', 'she', 'the', 'was', 'who', 'you',
  'de', 'du', 'el', 'en', 'et', 'la', 'le', 'un',
]);
const SHORT_WORD = 3;

export interface GuideSearchMatch {
  /** Everything to look through for what's on now */
  live: string;
  /** Title matches */
  title: string;
  /** Description-only matches; null when descriptions are skipped */
  mentions: string | null;
}

/**
 * The FTS5 queries for a search. One short word would otherwise match most of the guide
 * as a prefix (th: The, This, Thursday), so it starts a title word or is an exact word in
 * a description (tn finds "Nashville, TN", not TNT). Very common ones stay in titles.
 */
export function guideSearchMatch(query: string): GuideSearchMatch | null {
  const fts = toFtsQuery(query);
  if (!fts) return null;
  const words = wordsOf(fold(query));
  if (words.length === 1 && words[0].length <= SHORT_WORD) {
    const title = `title : ${fts}`;
    if (COMMON_SHORT_WORDS.has(words[0])) return { live: title, title, mentions: null };
    const description = `description : "${words[0]}"`;
    return { live: `(${title}) OR (${description})`, title, mentions: `(${description}) NOT (${title})` };
  }
  const title = `title : (${fts})`;
  return { live: fts, title, mentions: `(${fts}) NOT (${title})` };
}

/** Channel names: every word somewhere in the name. Symbols count, so E! finds E!. */
export function matchesChannelName(name: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const folded = fold(name);
  return words.every((w) => folded.includes(w));
}

/** Where to highlight: whole words that start with a word of the search, as offsets into `text`. */
export function matchRanges(text: string, query: string): Array<[number, number]> {
  const words = wordsOf(fold(query));
  if (!words.length) return [];
  let folded = '';
  const offsets: number[] = [];
  for (let i = 0; i < text.length;) {
    const size = (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
    const part = fold(text.slice(i, i + size));
    for (let k = 0; k < part.length; k++) offsets.push(i);
    folded += part;
    i += size;
  }
  offsets.push(text.length);
  const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  const out: Array<[number, number]> = [];
  for (let p = 0; p < folded.length; p++) {
    if (isWord(folded[p - 1]) || !words.some((w) => folded.startsWith(w, p))) continue;
    let end = p;
    while (isWord(folded[end])) end++;
    out.push([offsets[p], offsets[end]]);
    p = end;
  }
  return out;
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
