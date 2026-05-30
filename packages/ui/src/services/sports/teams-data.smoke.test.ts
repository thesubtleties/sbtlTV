// CANARY: asserts the COMMITTED snapshot. If this fails right after a
// `gen:teams` regen, ESPN's response shape changed — fix the generator,
// do NOT loosen these assertions or the matcher.
import { describe, it, expect } from 'vitest';
import { TEAMS_DATA } from './teams-data';
import { LEAGUE_IDS } from './types';
import { getDirectory } from './teams-directory';
import { matchProgramToMatchup } from './matchup-matcher';

describe('bundled teams-data', () => {
  it('has every league populated', () => {
    for (const id of LEAGUE_IDS) {
      expect(TEAMS_DATA[id]?.length ?? 0).toBeGreaterThan(0);
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
  it('resolves a known real matchup', () => {
    const r = matchProgramToMatchup(getDirectory(), 'NBA: Lakers @ Celtics');
    expect(r.status).toBe('matched');
    expect(r.matchup?.leagueId).toBe('nba');
  });
});
