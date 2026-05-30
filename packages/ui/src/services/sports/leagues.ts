import type { LeagueId } from './types';

export interface LeagueDef {
  id: LeagueId;
  espnSport: string; // ESPN "sport" path segment
  espnSlug: string; // ESPN "league" path segment
  titleTokens: string[]; // tokens that, if present in title/channel, hint this league
}

export const LEAGUES: LeagueDef[] = [
  { id: 'nfl', espnSport: 'football', espnSlug: 'nfl', titleTokens: ['nfl'] },
  { id: 'nba', espnSport: 'basketball', espnSlug: 'nba', titleTokens: ['nba'] },
  { id: 'mlb', espnSport: 'baseball', espnSlug: 'mlb', titleTokens: ['mlb'] },
  { id: 'nhl', espnSport: 'hockey', espnSlug: 'nhl', titleTokens: ['nhl'] },
  { id: 'cfb', espnSport: 'football', espnSlug: 'college-football', titleTokens: ['college football', 'ncaaf', 'cfb'] },
  { id: 'cbb', espnSport: 'basketball', espnSlug: 'mens-college-basketball', titleTokens: ['college basketball', 'ncaab', 'cbb'] },
];

/** Leagues whose bare school/location name is a safe directory key. */
export const COLLEGE_LEAGUES: ReadonlySet<LeagueId> = new Set<LeagueId>(['cfb', 'cbb']);
