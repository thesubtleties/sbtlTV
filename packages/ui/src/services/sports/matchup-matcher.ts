import type { LeagueId, Matchup, Team } from './types';
import { detectLeagueHint, stripLeadingLabel, splitSidesWithSeparator } from './normalize';
import { resolveTeam, type Directory } from './teams-directory';

export type MatchStatus = 'matched' | 'no-split' | 'unresolved' | 'ambiguous';

/** `matchup` is non-null IFF `status === 'matched'`. */
export type MatchResult =
  | { status: 'matched'; matchup: Matchup }
  | { status: 'no-split' | 'unresolved' | 'ambiguous'; matchup: null };

/**
 * Resolve an EPG program title to a confident two-team matchup, or null.
 * Conservative by design: anything less than an unambiguous single-league,
 * single-team-per-side result returns null (fail silent).
 */
export function matchProgramToMatchup(
  dir: Directory,
  epgTitle: string,
  channelName?: string,
): MatchResult {
  const hint = detectLeagueHint(epgTitle, channelName);
  const split = splitSidesWithSeparator(stripLeadingLabel(epgTitle));
  if (!split) return { status: 'no-split', matchup: null };
  const [rawA, rawB] = split.sides;
  return matchSides(resolveTeam(dir, rawA, hint), resolveTeam(dir, rawB, hint), hint, split.separator);
}

/** The league gate: both sides in exactly one shared league, one team each, not the same team. */
function matchSides(candA: Team[], candB: Team[], hint: LeagueId | undefined, separator: '@' | 'vs'): MatchResult {
  if (candA.length === 0 || candB.length === 0) {
    return { status: 'unresolved', matchup: null };
  }

  const leaguesA = new Set<LeagueId>(candA.map((t) => t.leagueId));
  const leaguesB = new Set<LeagueId>(candB.map((t) => t.leagueId));
  const shared = [...leaguesA].filter((l) => leaguesB.has(l));
  const candidateLeagues = hint && shared.includes(hint) ? [hint] : shared;
  if (candidateLeagues.length !== 1) {
    return { status: 'ambiguous', matchup: null };
  }

  const league = candidateLeagues[0];
  const teamsA = candA.filter((t) => t.leagueId === league);
  const teamsB = candB.filter((t) => t.leagueId === league);
  if (teamsA.length !== 1 || teamsB.length !== 1 || teamsA[0] === teamsB[0]) {
    return { status: 'ambiguous', matchup: null };
  }

  return { status: 'matched', matchup: { leagueId: league, away: teamsA[0], home: teamsB[0], separator } };
}

// Guide descriptions often name the game in a sentence under a generic title
// ("College Football": "The Nevada Wolf Pack visit the UTEP Miners in a Mountain
// West game."). Each form says which side the first team is on; the team names
// are then found by trying the words next to the verb against the directory, so
// a sentence about one team ("The Penguins face a tough road trip") finds no
// second team and stays unmatched.
// Verbs that join the two teams, found with plain substring searches (no
// regular expression over the whole sentence, so a long description cannot
// stall the interface). Each says which side is home, if any.
const PROSE_VERBS: Array<{ words: string[]; separator: '@' | 'vs'; firstIsHome?: boolean }> = [
  { words: ['visit', 'visits', 'travel to', 'travels to'], separator: '@' },
  { words: ['host', 'hosts', 'welcome', 'welcomes'], separator: '@', firstIsHome: true },
  { words: ['face', 'faces', 'meet', 'meets', 'play', 'plays', 'take on', 'takes on', 'battle', 'battles', 'clash', 'clashes', 'clash with', 'clashes with', 'square off', 'face off'], separator: 'vs' },
];
/** Longer sentences are not looked at: a game is named near the start of a description. */
const MAX_SENTENCE = 300;

/** The two sides of a sentence around a joining word: [before, after], or null. */
function aroundWord(sentence: string, word: string): [string, string] | null {
  const lower = sentence.toLowerCase();
  const needle = ` ${word} `;
  const at = lower.indexOf(needle);
  if (at <= 0) return null;
  return [sentence.slice(0, at), sentence.slice(at + needle.length)];
}

/** Words that can sit around a team name in a sentence: articles, rankings, records. */
function cleanProseSide(text: string): string {
  return text
    .replace(/\([^)]*\)/g, ' ')                    // records "(4-1)"
    .replace(/\b(?:no\.?|#)\s*\d+\b/gi, ' ')        // rankings "No. 20", "#3"
    .replace(/^\s*(?:as\s+)?the\s+/i, '')            // "The ...", "as the ..."
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The longest run of up to five words at one end of the text that names a team (the end next to the verb). */
function teamAtEnd(dir: Directory, text: string, end: 'start' | 'end', hint?: LeagueId): Team[] {
  const words = cleanProseSide(text).split(' ').filter(Boolean);
  for (let n = Math.min(5, words.length); n >= 1; n--) {
    const run = end === 'start' ? words.slice(0, n) : words.slice(words.length - n);
    const candidates = resolveTeam(dir, cleanProseSide(run.join(' ')), hint);
    if (candidates.length > 0) return candidates;
  }
  return [];
}

/** A game named in a sentence of a description, or null. */
function matchProse(dir: Directory, description: string, hint?: LeagueId): MatchResult | null {
  // A sentence ends at . ! ? before a capital letter, but not after "No." or "St." ("No. 16", "St. Louis").
  const sentences = description.slice(0, 2 * MAX_SENTENCE).split(/(?<!\b(?:No|St|Mt|Ft|Jr|Sr|vs))(?<=[.!?])\s+(?=[A-Z])/).slice(0, 2);
  for (const raw of sentences) {
    const sentence = raw.trim().slice(0, MAX_SENTENCE);
    const tries: Array<{ first: string; second: string; separator: '@' | 'vs'; firstIsHome?: boolean }> = [];
    // "A at B from <venue>."
    const fromVenue = aroundWord(sentence, 'from');
    const atSides = fromVenue && aroundWord(fromVenue[0], 'at');
    if (atSides) tries.push({ first: atSides[0], second: atSides[1], separator: '@' });
    for (const verb of PROSE_VERBS) {
      for (const word of verb.words) {
        const sides = aroundWord(sentence, word);
        if (!sides) continue;
        // "A and B meet ...": both teams before the verb.
        const pair = verb.separator === 'vs' ? aroundWord(sides[0], 'and') : null;
        if (pair) tries.push({ first: pair[0], second: pair[1], separator: 'vs' });
        tries.push({ first: sides[0], second: sides[1], separator: verb.separator, firstIsHome: verb.firstIsHome });
      }
    }
    for (const t of tries) {
      const first = teamAtEnd(dir, t.first, 'end', hint);
      const second = teamAtEnd(dir, t.second, 'start', hint);
      const result = t.firstIsHome ? matchSides(second, first, hint, t.separator) : matchSides(first, second, hint, t.separator);
      if (result.status === 'matched') return result;
    }
  }
  return null;
}

export interface ProgramInput {
  title?: string;
  description?: string;
  channelName?: string;
}

/**
 * Resolve a matchup from an EPG program, trying the TITLE first and falling back
 * to the DESCRIPTION. Some providers use a generic title ("NBA Playoffs") and put
 * the actual matchup ("Lakers at Jazz") in the description. Both go through the
 * same conservative gate, so a prose description with no "A vs/at/@ B" shape
 * simply doesn't resolve (never a wrong match).
 */
export function matchProgram(dir: Directory, input: ProgramInput): MatchResult {
  const { title, description, channelName } = input;
  const fromTitle = title ? matchProgramToMatchup(dir, title, channelName) : null;
  if (fromTitle?.status === 'matched') return fromTitle;
  const fromDesc = description ? matchProgramToMatchup(dir, description, channelName) : null;
  if (fromDesc?.status === 'matched') return fromDesc;
  const fromProse = description ? matchProse(dir, description, detectLeagueHint(title ?? '', channelName)) : null;
  if (fromProse) return fromProse;
  // Neither matched — surface the most informative non-matched status for logging.
  return fromDesc ?? fromTitle ?? { status: 'no-split', matchup: null };
}
