/** Single source of truth for the supported leagues. */
export const LEAGUE_IDS = ['nfl', 'nba', 'mlb', 'nhl', 'cfb', 'cbb'] as const;
export type LeagueId = (typeof LEAGUE_IDS)[number];

/** One team in the bundled directory. */
export interface Team {
  leagueId: LeagueId;
  location: string; // pro: "Los Angeles"; college: school e.g. "Duke"
  nickname: string; // "Lakers" / "Blue Devils"
  displayName: string; // "Los Angeles Lakers" / "Duke Blue Devils"
  abbrev: string; // "LAL"
  logoUrl: string; // ESPN CDN logo URL
}

/** A confidently-identified game between two teams in the same league. */
export interface Matchup {
  leagueId: LeagueId;
  away: Team;
  home: Team;
}

/** Bundled directory payload, keyed by league id. */
export type TeamsData = Record<string, Team[]>;
