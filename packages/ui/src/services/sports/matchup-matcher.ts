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
const PROSE_FORMS: Array<{ re: RegExp; separator: '@' | 'vs'; firstIsHome?: boolean }> = [
  { re: /^(.+?)\s+(?:at|@)\s+(.+?)\s+from\s+\S.*$/i, separator: '@' },  // "A at B from <venue>."
  { re: /^(.+?)\s+(?:visit|visits|travel to|travels to)\s+(.+)$/i, separator: '@' },
  { re: /^(.+?)\s+(?:host|hosts|welcome|welcomes)\s+(.+)$/i, separator: '@', firstIsHome: true },
  { re: /^(.+?)\s+and\s+(.+?)\s+(?:meet|clash|square off|face off|battle|play)\b.*$/i, separator: 'vs' },
  { re: /^(.+?)\s+(?:face|faces|meet|meets|play|plays|take on|takes on|battle|battles|clash with|clashes with)\s+(.+)$/i, separator: 'vs' },
];

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
  const sentences = description.split(/(?<!\b(?:No|St|Mt|Ft|Jr|Sr|vs))(?<=[.!?])\s+(?=[A-Z])/).slice(0, 2);
  for (const sentence of sentences) {
    for (const form of PROSE_FORMS) {
      const m = sentence.trim().match(form.re);
      if (!m) continue;
      const first = teamAtEnd(dir, m[1], 'end', hint);
      const second = teamAtEnd(dir, m[2], 'start', hint);
      const result = form.firstIsHome
        ? matchSides(second, first, hint, form.separator)
        : matchSides(first, second, hint, form.separator);
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
