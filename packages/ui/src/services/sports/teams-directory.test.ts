import { describe, it, expect } from 'vitest';
import { buildDirectory, resolveTeam } from './teams-directory';
import type { Team, TeamsData } from './types';

function team(p: Partial<Team> & Pick<Team, 'leagueId' | 'location' | 'nickname' | 'abbrev'>): Team {
  return { displayName: `${p.location} ${p.nickname}`.trim(), logoUrl: 'x', ...p };
}

const DATA: TeamsData = {
  nba: [
    team({ leagueId: 'nba', location: 'Los Angeles', nickname: 'Lakers', abbrev: 'LAL' }),
    team({ leagueId: 'nba', location: 'LA', nickname: 'Clippers', abbrev: 'LAC' }),
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
    team({ leagueId: 'cbb', location: 'Miami', nickname: 'Hurricanes', abbrev: 'MIA' }),
  ],
};

describe('resolveTeam', () => {
  const dir = buildDirectory(DATA);

  it('resolves by nickname', () => {
    expect(resolveTeam(dir, 'Lakers').map((t) => t.abbrev)).toEqual(['LAL']);
  });
  it('resolves by full display name', () => {
    expect(resolveTeam(dir, 'Los Angeles Lakers').map((t) => t.abbrev)).toEqual(['LAL']);
  });
  it('resolves college by bare school/location', () => {
    expect(resolveTeam(dir, 'Duke').map((t) => t.abbrev)).toEqual(['DUKE']);
  });
  it('strips a leading #rank', () => {
    expect(resolveTeam(dir, '#1 Duke').map((t) => t.abbrev)).toEqual(['DUKE']);
  });
  it('strips a parenthetical suffix', () => {
    expect(resolveTeam(dir, 'Miami (FL)').map((t) => t.abbrev)).toEqual(['MIA']);
  });
  it('returns multiple teams for a shared nickname (cross-league)', () => {
    expect(resolveTeam(dir, 'Cardinals').map((t) => t.leagueId).sort()).toEqual(['mlb', 'nfl']);
  });
  it('filters to a league hint when given', () => {
    expect(resolveTeam(dir, 'Cardinals', 'nfl').map((t) => t.abbrev)).toEqual(['ARI']);
  });
  it('returns empty for unknown', () => {
    expect(resolveTeam(dir, 'Definitely Not A Team')).toEqual([]);
  });

  // City-abbreviation equivalence (ESPN stores Lakers as "Los Angeles", Clippers as "LA").
  it('matches an LA team written in the Los Angeles form', () => {
    expect(resolveTeam(dir, 'Los Angeles Clippers').map((t) => t.abbrev)).toEqual(['LAC']);
  });
  it('matches an LA team written in the abbreviated LA form', () => {
    expect(resolveTeam(dir, 'LA Lakers').map((t) => t.abbrev)).toEqual(['LAL']);
  });
});
