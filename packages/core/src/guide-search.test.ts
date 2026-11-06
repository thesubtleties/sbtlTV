import { describe, it, expect } from 'vitest';
import { groupAirings, guideSearchMatch, isAdultCategoryName, isAiringLive, isTitleMatch, matchRanges, matchesChannelName, sortChannels, toFtsQuery, type GuideSearchRow } from './guide-search';

const row = (over: Partial<GuideSearchRow>): GuideSearchRow => ({
  id: 'p1', title: 'Football Night', description: '', start: 1000, end: 2000, rank: -5,
  stream_id: 's1', channel_name: 'CBS', stream_icon: '', ...over,
});

describe('toFtsQuery', () => {
  it('makes every word a quoted prefix', () => {
    expect(toFtsQuery('man utd')).toBe('"man"* AND "utd"*');
  });
  it('turns symbols into plain text, never syntax', () => {
    expect(toFtsQuery('c++')).toBeNull();   // one letter once the symbols go
    expect(toFtsQuery('AT&T')).toBe('"at t"*');
    expect(toFtsQuery('"quoted" (x) NOT -y')).toBe('"quoted"* AND "x"* AND "not"* AND "y"*');
  });
  it('is null for nothing searchable or a single letter', () => {
    expect(toFtsQuery('')).toBeNull();
    expect(toFtsQuery('  ')).toBeNull();
    expect(toFtsQuery('***')).toBeNull();
    expect(toFtsQuery('a')).toBeNull();
  });
  it('keeps non-Latin letters', () => {
    expect(toFtsQuery('fútbol 東京')).toBe('"fútbol"* AND "東京"*');
  });
});

describe('isTitleMatch', () => {
  it('needs every word as a word start, ignoring accents and case', () => {
    expect(isTitleMatch('Fútbol Liga', 'futb lig')).toBe(true);
    expect(isTitleMatch('The Big Show', 'big news')).toBe(false);
    expect(isTitleMatch('Superbowl', 'bowl')).toBe(false);
  });
});

describe('isAdultCategoryName', () => {
  it('matches the real category names', () => {
    for (const n of ['24/7 Adult', 'Adults', 'Adults (18+)', 'Adults 24-7', 'VOD Adults', 'XXX Live', '18+ Only']) {
      expect(isAdultCategoryName(n)).toBe(true);
    }
  });
  it('leaves ordinary and near-miss names alone', () => {
    for (const n of ['Adult Swim', 'Young Adult Movies', 'USA Sports', 'UK: Kids', 'Top 18 Rugby', 'Saxxon TV']) {
      expect(isAdultCategoryName(n)).toBe(n === 'Young Adult Movies');
    }
  });
});

describe('isAiringLive', () => {
  it('is live from its start time', () => {
    expect(isAiringLive({ startMs: 100 }, 99)).toBe(false);
    expect(isAiringLive({ startMs: 100 }, 100)).toBe(true);
  });
});

describe('groupAirings', () => {
  it('makes one airing per title and start, with each channel once', () => {
    const out = groupAirings([
      row({ id: 'a', stream_id: 's1', channel_name: 'CBS' }),
      row({ id: 'b', stream_id: 's2', channel_name: 'CBS HD' }),
      row({ id: 'c', stream_id: 's2', channel_name: 'CBS HD' }),
    ], 'football', 1500);
    expect(out.onNow).toHaveLength(1);
    expect(out.onNow[0].channels.map((c) => c.stream_id)).toEqual(['s1', 's2']);
    expect(out.onNow[0].programIds).toEqual(['a', 'b', 'c']);
  });
  it('splits on now, later and description mentions', () => {
    const out = groupAirings([
      row({ id: 'now', start: 1000, end: 3000 }),
      row({ id: 'soon', title: 'Football Late', start: 5000, end: 6000 }),
      row({ id: 'desc', title: 'Sunday Show', description: 'all the football', start: 900, end: 3000 }),
    ], 'football', 2000);
    expect(out.onNow.map((a) => a.title)).toEqual(['Football Night', 'Sunday Show']);
    expect(out.later.map((a) => a.title)).toEqual(['Football Late']);
  });
  it('sorts on now by relevance, later by time, mentions on now first', () => {
    const out = groupAirings([
      row({ id: '1', title: 'Football A', rank: -1, start: 100, end: 9000 }),
      row({ id: '2', title: 'Football B', rank: -9, start: 100, end: 9000 }),
      row({ id: '3', title: 'Football C', start: 8000, end: 9000 }),
      row({ id: '4', title: 'Football D', start: 7000, end: 9000 }),
      row({ id: '5', title: 'M later', description: 'football', start: 7000, end: 9000 }),
      row({ id: '6', title: 'M now', description: 'football', start: 100, end: 9000 }),
    ], 'football', 500);
    expect(out.onNow.map((a) => a.title)).toEqual(['Football B', 'Football A', 'M now']);
    expect(out.later.map((a) => a.title)).toEqual(['Football D', 'Football C']);
    expect(out.mentions.map((a) => a.title)).toEqual(['M later']);
  });
});

describe('toFtsQuery edge cases', () => {
  it('needs at least one real word', () => {
    expect(toFtsQuery('a b')).toBeNull();
    expect(toFtsQuery('a beautiful')).toBe('"a"* AND "beautiful"*');
  });
  it('folds a capital dotted I', () => {
    expect(toFtsQuery('İstanbul')).toBe(`"${'İstanbul'.normalize('NFC').toLowerCase()}"*`);
  });
});

describe('guideSearchMatch', () => {
  it('matches a normal search anywhere, starts of words', () => {
    expect(guideSearchMatch('man utd')).toEqual({
      live: '"man"* AND "utd"*',
      title: 'title : ("man"* AND "utd"*)',
      mentions: '("man"* AND "utd"*) NOT (title : ("man"* AND "utd"*))',
    });
  });
  it('takes one short word as a title start or an exact description word', () => {
    expect(guideSearchMatch('tn')).toEqual({
      live: '(title : "tn"*) OR (description : "tn")',
      title: 'title : "tn"*',
      mentions: '(description : "tn") NOT (title : "tn"*)',
    });
    expect(guideSearchMatch('nfl')?.live).toBe('(title : "nfl"*) OR (description : "nfl")');
  });
  it('looks at titles only for very common short words', () => {
    for (const w of ['the', 'to', 'in', 'of', 'and', 'THE']) {
      const m = guideSearchMatch(w);
      expect(m).toEqual({ live: `title : "${w.toLowerCase()}"*`, title: `title : "${w.toLowerCase()}"*`, mentions: null });
    }
  });
  it('leaves a short word in a longer search alone', () => {
    expect(guideSearchMatch('the office')?.live).toBe('"the"* AND "office"*');
  });
  it('is null when there is nothing to search', () => {
    expect(guideSearchMatch('c+')).toBeNull();
    expect(guideSearchMatch('')).toBeNull();
  });
});

describe('matchesChannelName', () => {
  it('needs every word somewhere in the name', () => {
    expect(matchesChannelName('UK: BBC One', 'uk bbc')).toBe(true);
    expect(matchesChannelName('UK: BBC One', 'uk itv')).toBe(false);
    expect(matchesChannelName('USA ESPN2 HD', 'espn2')).toBe(true);
  });
  it('ignores accents and case in any alphabet', () => {
    expect(matchesChannelName('Fútbol TV', 'futbol')).toBe(true);
    expect(matchesChannelName('РОССИЯ 1', 'россия')).toBe(true);
  });
  it('keeps symbols, so short names still match', () => {
    expect(matchesChannelName('USA E! HD', 'e!')).toBe(true);
    expect(matchesChannelName('USA ESPN', 'e!')).toBe(false);
  });
});

describe('matchRanges', () => {
  const marked = (text: string, q: string) => matchRanges(text, q).map(([a, b]) => text.slice(a, b));
  it('finds the whole word from where it starts', () => {
    expect(marked('Football Night', 'foot')).toEqual(['Football']);
    expect(marked('The Big Show', 'big show')).toEqual(['Big', 'Show']);
  });
  it('handles accents and other alphabets', () => {
    expect(marked('Fútbol Liga', 'futb')).toEqual(['Fútbol']);
    expect(marked('Étoile', 'étoile')).toEqual(['Étoile']);
    expect(marked('матч Футбол', 'футбол')).toEqual(['Футбол']);
  });
  it('does not match inside a word', () => {
    expect(marked('Sports', 'port')).toEqual([]);
  });
  it('keeps offsets right after a character that folds away', () => {
    expect(marked('é é foot', 'foot')).toEqual(['foot']);
  });
});

describe('groupAirings: what counts as one airing', () => {
  it('keeps each showing of a repeat as its own row', () => {
    const out = groupAirings([row({ id: 'a', start: 5000, end: 6000 }), row({ id: 'b', start: 8000, end: 9000 })], 'football', 1000);
    expect([out.later[0].startMs, ...(out.later[0].more ?? []).map((a) => a.startMs)]).toEqual([5000, 8000]);
  });
  it('ranks an airing by its best feed, whichever feed came first', () => {
    const out = groupAirings([
      row({ id: '1', title: 'Football A', rank: -5 }),
      row({ id: '2', title: 'Football B', stream_id: 's1', rank: -1 }),
      row({ id: '3', title: 'Football B', stream_id: 's2', rank: -9 }),
    ], 'football', 1500);
    expect(out.onNow.map((a) => a.title)).toEqual(['Football B', 'Football A']);
  });
  it('orders mentions of the same kind by start time', () => {
    const out = groupAirings([
      row({ id: '1', title: 'M one', description: 'football', start: 9000, end: 9500 }),
      row({ id: '2', title: 'M two', description: 'football', start: 7000, end: 7500 }),
    ], 'football', 500);
    expect(out.mentions.map((a) => a.title)).toEqual(['M two', 'M one']);
  });
});

describe('isAdultCategoryName: providers shout', () => {
  it('ignores case both ways', () => {
    for (const n of ['ADULTS', 'adult', 'xxx', 'VIP | XXX']) expect(isAdultCategoryName(n)).toBe(true);
    for (const n of ['ADULT SWIM', 'adult swim', 'US: Adult Swim HD']) expect(isAdultCategoryName(n)).toBe(false);
  });
});

describe('matchRanges: offsets a renderer can trust', () => {
  const marked = (text: string, q: string) => matchRanges(text, q).map(([a, b]) => text.slice(a, b));
  it('ends a word at the end of the text with a real number', () => {
    expect(matchRanges('Big Show', 'show')).toEqual([[4, 8]]);
  });
  it('keeps offsets right when a combining mark folds away', () => {
    expect(matchRanges('é foot', 'foot')).toEqual([[3, 7]]);
    expect(marked('Café Night', 'cafe')).toEqual(['Café']);
  });
  it('keeps offsets right when a letter folds into several', () => {
    expect(marked('한국 뉴스 속보', '뉴스')).toEqual(['뉴스']);
  });
  it('keeps offsets right after an emoji', () => {
    expect(marked('🏈 Football', 'foot')).toEqual(['Football']);
  });
});

describe('search words', () => {
  it('sends every alphabet as written and lets the index fold it', () => {
    for (const w of ['хоккей', '뉴스', 'ドラマ', 'हिन्दी', 'أخبار', 'ειδήσεις']) expect(toFtsQuery(w)).toBe(`"${w.normalize('NFC')}"*`);
  });
  it('takes a word with symbols inside as one phrase', () => {
    expect(toFtsQuery('9-1-1')).toBe('"9 1 1"*');
    expect(toFtsQuery('m*a*s*h')).toBe('"m a s h"*');
    expect(toFtsQuery('s.w.a.t.')).toBe('"s w a t"*');
    expect(toFtsQuery('spider-man')).toBe('"spider man"*');
  });
  it('takes spaced single letters as one phrase, from three', () => {
    expect(toFtsQuery('9 1 1')).toBe('"9 1 1"*');
    expect(toFtsQuery('a b')).toBeNull();
  });
  it('tries a word ending in s as a possessive too', () => {
    expect(toFtsQuery('greys anatomy')).toBe('("greys"* OR "grey s"*) AND "anatomy"*');
    expect(toFtsQuery('bobs burgers')).toBe('("bobs"* OR "bob s"*) AND ("burgers"* OR "burger s"*)');
  });
  it('drops "and" between words, like &', () => {
    expect(toFtsQuery('law and order')).toBe('"law"* AND "order"*');
    expect(toFtsQuery('and')).toBe('"and"*');
  });
  it('repeats nothing, and stops at 8 words', () => {
    expect(toFtsQuery('news news news')).toBe('"news"*');
    const many = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
    expect(toFtsQuery(many)?.split(' AND ')).toHaveLength(8);
  });
});

describe('guideSearchMatch while a longer search is being typed', () => {
  it('stays in titles until the last word has 3 letters', () => {
    expect(guideSearchMatch('the w')).toEqual({ live: 'title : ("the"* AND "w"*)', title: 'title : ("the"* AND "w"*)', mentions: null });
    expect(guideSearchMatch('the wa')?.mentions).toBeNull();
    expect(guideSearchMatch('the wal')?.mentions).not.toBeNull();
  });
  it('does not treat a phrase word as short', () => {
    expect(guideSearchMatch('9-1-1')?.live).toBe('"9 1 1"*');
  });
});

describe('sortChannels', () => {
  const c = (name: string, has_guide = 0) => ({ stream_id: name, name, stream_icon: '', has_guide });
  it('puts names with a word starting so ahead of names containing it, then those with a guide', () => {
    const out = sortChannels([c('24/7 Earth Final Conflict'), c('Inflight'), c('CA NFL Network'), c('USA NFL Network', 1)], 'nfl');
    expect(out.map((x) => x.name)).toEqual(['USA NFL Network', 'CA NFL Network', '24/7 Earth Final Conflict', 'Inflight']);
  });
});

describe('groupAirings: Later', () => {
  const rows = [1, 2, 3].map((n) => row({ id: `s${n}`, title: 'The Simpsons', start: 5000 * n, end: 5000 * n + 100, stream_id: `c${n}` }));
  it('is one row per show, the next airing first, the rest under it', () => {
    const out = groupAirings(rows, 'simpsons', 1000);
    expect(out.later).toHaveLength(1);
    expect(out.later[0].startMs).toBe(5000);
    expect(out.later[0].more?.map((a) => a.startMs)).toEqual([10000, 15000]);
  });
  it('treats a title in any case as one show, and one airing', () => {
    const out = groupAirings([row({ id: 'a', title: 'FlashPoint', start: 5000, end: 6000, stream_id: 'x' }), row({ id: 'b', title: 'Flashpoint', start: 5000, end: 6000, stream_id: 'y' })], 'flashpoint', 1000);
    expect(out.later).toHaveLength(1);
    expect(out.later[0].channels).toHaveLength(2);
  });
  it('puts the exact title first, then by next airing', () => {
    const out = groupAirings([
      row({ id: 'a', title: 'Thomas & Friends', start: 2000, end: 3000 }),
      row({ id: 'b', title: 'Friends', start: 9000, end: 9500 }),
    ], 'friends', 1000);
    expect(out.later.map((a) => a.title)).toEqual(['Friends', 'Thomas & Friends']);
  });
});

describe('groupAirings: a live show that only its description matches', () => {
  it('moves the best 3 up to On now, marked', () => {
    const live = [1, 2, 3, 4].map((n) => row({ id: `m${n}`, title: `Game ${n}`, description: 'the nfl', start: 100, end: 9000, rank: -n }));
    const out = groupAirings(live, 'nfl', 500);
    expect(out.onNow.map((a) => a.title)).toEqual(['Game 4', 'Game 3', 'Game 2']);
    expect(out.onNow.every((a) => a.byDescription)).toBe(true);
    expect(out.mentions.map((a) => a.title)).toEqual(['Game 1']);
  });
});

describe('isAdultCategoryName, other spellings', () => {
  it('knows the common ones', () => {
    for (const n of ['+18', 'Adultes +18', 'Adultos', 'Adulti']) expect(isAdultCategoryName(n)).toBe(true);
  });
});
