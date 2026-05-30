import { describe, it, expect } from 'vitest';
import { LEAGUES, COLLEGE_LEAGUES } from './leagues';
import { LEAGUE_IDS } from './types';

describe('LEAGUES', () => {
  it('covers every LeagueId exactly once', () => {
    expect(LEAGUES.map((l) => l.id).sort()).toEqual([...LEAGUE_IDS].sort());
  });
  it('college set is a subset of known leagues', () => {
    for (const id of COLLEGE_LEAGUES) expect(LEAGUE_IDS).toContain(id);
  });
});
