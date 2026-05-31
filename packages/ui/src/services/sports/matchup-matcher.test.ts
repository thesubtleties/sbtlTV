import { describe, it, expect } from 'vitest';
import { buildDirectory } from './teams-directory';
import { matchProgramToMatchup } from './matchup-matcher';
import type { Team, TeamsData } from './types';

function team(p: Partial<Team> & Pick<Team, 'leagueId' | 'location' | 'nickname' | 'abbrev'>): Team {
  return { displayName: `${p.location} ${p.nickname}`.trim(), logoUrl: 'x', ...p };
}

const dir = buildDirectory({
  nba: [
    team({ leagueId: 'nba', location: 'Los Angeles', nickname: 'Lakers', abbrev: 'LAL' }),
    team({ leagueId: 'nba', location: 'Boston', nickname: 'Celtics', abbrev: 'BOS' }),
  ],
  nfl: [
    team({ leagueId: 'nfl', location: 'Arizona', nickname: 'Cardinals', abbrev: 'ARI' }),
    team({ leagueId: 'nfl', location: 'New York', nickname: 'Giants', abbrev: 'NYG' }),
  ],
  mlb: [
    team({ leagueId: 'mlb', location: 'St. Louis', nickname: 'Cardinals', abbrev: 'STL' }),
    team({ leagueId: 'mlb', location: 'San Francisco', nickname: 'Giants', abbrev: 'SF' }),
  ],
  cbb: [
    team({ leagueId: 'cbb', location: 'Duke', nickname: 'Blue Devils', abbrev: 'DUKE' }),
    team({ leagueId: 'cbb', location: 'North Carolina', nickname: 'Tar Heels', abbrev: 'UNC' }),
    // Three "Bulldogs" to force a mascot collision:
    team({ leagueId: 'cbb', location: 'Georgia', nickname: 'Bulldogs', abbrev: 'UGA' }),
    team({ leagueId: 'cbb', location: 'Gonzaga', nickname: 'Bulldogs', abbrev: 'GONZ' }),
    team({ leagueId: 'cbb', location: 'Butler', nickname: 'Bulldogs', abbrev: 'BUT' }),
  ],
} as TeamsData);

describe('matchProgramToMatchup', () => {
  it('matches a clean nickname matchup', () => {
    const r = matchProgramToMatchup(dir, 'Lakers @ Celtics');
    expect(r.status).toBe('matched');
    expect(r.matchup?.leagueId).toBe('nba');
    expect([r.matchup?.away.abbrev, r.matchup?.home.abbrev]).toEqual(['LAL', 'BOS']);
  });
  it('matches a prefixed, full-name matchup', () => {
    expect(matchProgramToMatchup(dir, 'NBA: Los Angeles Lakers vs Boston Celtics').status).toBe('matched');
  });
  it('matches college by school names with prefix', () => {
    const r = matchProgramToMatchup(dir, 'College Basketball: Duke vs North Carolina');
    expect(r.status).toBe('matched');
    expect(r.matchup?.leagueId).toBe('cbb');
  });
  it('matches a ranked college matchup (#-prefixes)', () => {
    expect(matchProgramToMatchup(dir, 'College Basketball: #1 Duke vs #4 North Carolina').status).toBe('matched');
  });
  it('matches a dash-delimited league label', () => {
    expect(matchProgramToMatchup(dir, 'NBA - Lakers at Celtics').status).toBe('matched');
  });
  it('is ambiguous (null) for a shared-nickname matchup with no league signal', () => {
    const r = matchProgramToMatchup(dir, 'Cardinals vs Giants');
    expect(r.matchup).toBeNull();
    expect(r.status).toBe('ambiguous');
  });
  it('resolves the shared-nickname matchup when the league is signalled in the title', () => {
    const r = matchProgramToMatchup(dir, 'NFL: Cardinals vs Giants');
    expect(r.status).toBe('matched');
    expect([r.matchup?.away.abbrev, r.matchup?.home.abbrev]).toEqual(['ARI', 'NYG']);
  });
  it('resolves a shared-nickname matchup via the channel-name hint', () => {
    const r = matchProgramToMatchup(dir, 'Cardinals vs Giants', 'MLB Network');
    expect(r.status).toBe('matched');
    expect(r.matchup?.leagueId).toBe('mlb');
  });
  it('is ambiguous (null) for a mascot-only college collision', () => {
    expect(matchProgramToMatchup(dir, 'College Basketball: Bulldogs vs Duke').status).toBe('ambiguous');
  });
  it('returns no-split for non-matchup titles', () => {
    expect(matchProgramToMatchup(dir, 'SportsCenter').status).toBe('no-split');
  });
  it('returns unresolved when sides split but teams are unknown', () => {
    expect(matchProgramToMatchup(dir, 'Sharks @ Kings').status).toBe('unresolved');
  });
  it('is ambiguous when both sides resolve to the same team', () => {
    expect(matchProgramToMatchup(dir, 'Lakers @ Lakers').status).toBe('ambiguous');
  });
});
