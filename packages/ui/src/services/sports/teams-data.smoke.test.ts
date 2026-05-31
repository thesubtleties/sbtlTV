// CANARY: asserts the COMMITTED snapshot. If this fails right after a
// `gen:teams` regen, ESPN's response shape changed — fix the generator,
// do NOT loosen these assertions or the matcher.
import { describe, it, expect } from 'vitest';
import { TEAMS_DATA } from './teams-data';
import { LEAGUE_IDS } from './types';
import { getDirectory } from './teams-directory';
import { matchProgramToMatchup } from './matchup-matcher';

describe('bundled teams-data', () => {
  const MIN_TEAMS: Record<string, number> = { nfl: 30, nba: 28, mlb: 28, nhl: 30, cfb: 300, cbb: 200 };
  it('has each league populated above a sane floor (canary for a broken regen)', () => {
    for (const id of LEAGUE_IDS) {
      expect(TEAMS_DATA[id]?.length ?? 0, id).toBeGreaterThanOrEqual(MIN_TEAMS[id]);
    }
  });
  it('every team has a logo URL and abbrev', () => {
    for (const teams of Object.values(TEAMS_DATA)) {
      for (const t of teams) {
        expect(t.logoUrl).toMatch(/^https?:\/\//);
        expect(t.abbrev.length).toBeGreaterThan(0);
      }
    }
  });
  it('resolves known real matchups across every league', () => {
    const cases: Array<[string, string]> = [
      ['NBA: Lakers @ Celtics', 'nba'],
      ['NFL: Chiefs at Bills', 'nfl'],
      ['MLB: Yankees vs Red Sox', 'mlb'],
      ['NHL: Bruins vs Maple Leafs', 'nhl'],
      ['College Football: Alabama vs Georgia', 'cfb'],
      ['College Basketball: Duke vs North Carolina', 'cbb'],
    ];
    for (const [title, league] of cases) {
      const r = matchProgramToMatchup(getDirectory(), title);
      expect(r.status, title).toBe('matched');
      expect(r.matchup?.leagueId, title).toBe(league);
    }
  });
});
