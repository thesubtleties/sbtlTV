// Guide search rules (pure, used by the data process and the renderer).

export interface GuideSearchRow {
  id: string; title: string; description: string; start: number; end: number; rank: number;
  stream_id: string; channel_name: string; stream_icon: string;
}
export interface GuideSearchChannel { stream_id: string; name: string; stream_icon: string; has_guide?: number }
export interface GuideAiring {
  key: string; title: string; description: string; startMs: number; endMs: number;
  channels: GuideSearchChannel[]; programIds: string[];
  /** Later: this show's other airings, soonest first */
  more?: GuideAiring[];
  /** On now only because its description matches */
  byDescription?: boolean;
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

const MAX_WORDS = 8;
const POSSESSIVE_FROM = 3;

/**
 * What was typed, as the index stores it. Case and form only: the tokenizer does the accent
 * folding, and folding here too would lose what it keeps (Korean, й, Hindi vowel signs).
 * A word with symbols inside is a phrase (9-1-1, spider-man), as the index splits it.
 */
function searchTerms(query: string): string[] {
  const chunks = query.normalize('NFC').toLowerCase().split(/\s+/)
    .map((c) => c.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean)).filter((p) => p.length > 0);
  if (chunks.length >= 3 && chunks.every((p) => p.length === 1 && p[0].length === 1)) return [chunks.flat().join(' ')];
  const terms = [...new Set(chunks.map((p) => p.join(' ')))];
  return (terms.length > 1 ? terms.filter((t) => t !== 'and') : terms).slice(0, MAX_WORDS);
}

const isSearchable = (terms: string[]) => terms.some((t) => t.replace(/ /g, '').length >= GUIDE_SEARCH_MIN_CHARS);

/** Quoted, so nothing typed is ever syntax. In a longer search, greys also finds Grey's. */
function termMatch(term: string, possessive: boolean): string {
  if (!possessive || term.includes(' ') || term.length < POSSESSIVE_FROM || !term.endsWith('s')) return `"${term}"*`;
  return `("${term}"* OR "${term.slice(0, -1)} s"*)`;
}

/** The FTS5 query for what was typed. */
export function toFtsQuery(query: string): string | null {
  const terms = searchTerms(query);
  if (!isSearchable(terms)) return null;
  return terms.map((t) => termMatch(t, terms.length > 1)).join(' AND ');
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
  const terms = searchTerms(query);
  const [only] = terms;
  if (terms.length === 1 && !only.includes(' ') && only.length <= SHORT_WORD) {
    const title = `title : ${fts}`;
    if (COMMON_SHORT_WORDS.has(only)) return { live: title, title, mentions: null };
    const description = `description : "${only}"`;
    return { live: `(${title}) OR (${description})`, title, mentions: `(${description}) NOT (${title})` };
  }
  const title = `title : (${fts})`;
  // Mid-word in a longer search (the w...): descriptions would be most of the guide
  const last = terms[terms.length - 1];
  if (terms.length > 1 && !last.includes(' ') && last.length < SHORT_WORD) return { live: title, title, mentions: null };
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

/** Every word starts a word of the title. Grey's counts as greys, and & as and. */
export function isTitleMatch(title: string, query: string): boolean {
  const folded = fold(title);
  const inTitle = [...wordsOf(folded), ...wordsOf(folded.replace(/['\u2019]/g, ''))];
  const words = wordsOf(fold(query));
  return (words.length > 1 ? words.filter((w) => w !== 'and') : words).every((w) => inTitle.some((t) => t.startsWith(w)));
}

/** Names with a word starting so come first, then channels that have a guide. */
export function sortChannels<T extends { name: string; has_guide?: number }>(channels: T[], query: string): T[] {
  const score = (c: T) => (isTitleMatch(c.name, query) ? 0 : 2) + (c.has_guide ? 0 : 1);
  return channels.map((c) => ({ c, s: score(c) })).sort((a, b) => a.s - b.s).map((x) => x.c);
}

/** By name, because providers rarely set is_adult. Best effort: "Adult Swim" is not. */
export function isAdultCategoryName(name: string): boolean {
  if (/\badult swim\b/i.test(name)) return false;
  return /\b(adult(s|es|os|i)?|xxx)\b/i.test(name) || name.includes('18+') || name.includes('+18');
}

export function isAiringLive(airing: { startMs: number }, nowMs: number): boolean {
  return airing.startMs <= nowMs;
}

const MAX_SHOWS = 40;
const LIVE_MENTIONS = 3;

type Grouped = GuideAiring & { rank: number; titleHit: boolean };

/** One row per show: its next airing, the rest under it, an exact title first. */
function byShow(airings: Grouped[], query: string): GuideAiring[] {
  const shows = new Map<string, Grouped[]>();
  for (const a of [...airings].sort((x, y) => x.startMs - y.startMs)) {
    const key = fold(a.title);
    (shows.get(key) ?? shows.set(key, []).get(key)!).push(a);
  }
  const exact = fold(query.trim());
  return [...shows.entries()]
    .sort(([ka, a], [kb, b]) => Number(kb === exact) - Number(ka === exact) || a[0].startMs - b[0].startMs)
    .slice(0, MAX_SHOWS)
    .map(([, [next, ...rest]]) => ({ ...next, ...(rest.length ? { more: rest } : {}) }));
}

export function groupAirings(rows: GuideSearchRow[], query: string, nowMs: number): Pick<GuideSearchResult, 'onNow' | 'later' | 'mentions'> {
  const groups = new Map<string, Grouped>();
  for (const r of rows) {
    const key = `${fold(r.title)}|${r.start}`;
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
  const live = (g: GuideAiring) => isAiringLive(g, nowMs);
  const byRank = (a: Grouped, b: Grouped) => a.rank - b.rank;
  const hits = all.filter((g) => g.titleHit);
  const mentions = all.filter((g) => !g.titleHit);
  // A game whose title says nothing (Jaguars at Ravens for nfl) still belongs near what's on
  const liveMentions = mentions.filter(live).sort(byRank);
  return {
    onNow: [...hits.filter(live).sort(byRank), ...liveMentions.slice(0, LIVE_MENTIONS).map((g) => ({ ...g, byDescription: true }))],
    later: byShow(hits.filter((g) => !live(g)), query),
    mentions: [...liveMentions.slice(LIVE_MENTIONS), ...byShow(mentions.filter((g) => !live(g)), query)],
  };
}
