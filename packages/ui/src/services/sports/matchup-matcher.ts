import type { LeagueId, Matchup } from './types';
import { detectLeagueHint, stripLeadingLabel, splitSides } from './normalize';
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
  const sides = splitSides(stripLeadingLabel(epgTitle));
  if (!sides) return { status: 'no-split', matchup: null };

  const [rawA, rawB] = sides;
  const candA = resolveTeam(dir, rawA, hint);
  const candB = resolveTeam(dir, rawB, hint);
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

  return { status: 'matched', matchup: { leagueId: league, away: teamsA[0], home: teamsB[0] } };
}
