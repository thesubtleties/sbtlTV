import { describe, it, expect } from 'vitest';
import { buildDirectory } from './teams-directory';
import { matchProgram, matchProgramToMatchup } from './matchup-matcher';
import type { Team, TeamsData } from './types';

function team(p: Partial<Team> & Pick<Team, 'leagueId' | 'location' | 'nickname' | 'abbrev'>): Team {
  return { displayName: `${p.location} ${p.nickname}`.trim(), logoUrl: 'x', ...p };
}

const dir = buildDirectory({
  nba: [
    team({ leagueId: 'nba', location: 'Los Angeles', nickname: 'Lakers', abbrev: 'LAL' }),
    team({ leagueId: 'nba', location: 'Boston', nickname: 'Celtics', abbrev: 'BOS' }),
    team({ leagueId: 'nba', location: 'New York', nickname: 'Knicks', abbrev: 'NY' }),
    team({ leagueId: 'nba', location: 'Toronto', nickname: 'Raptors', abbrev: 'TOR' }),
  ],
  nhl: [
    team({ leagueId: 'nhl', location: 'Pittsburgh', nickname: 'Penguins', abbrev: 'PIT' }),
    team({ leagueId: 'nhl', location: 'Chicago', nickname: 'Blackhawks', abbrev: 'CHI' }),
  ],
  nfl: [
    team({ leagueId: 'nfl', location: 'Arizona', nickname: 'Cardinals', abbrev: 'ARI' }),
    team({ leagueId: 'nfl', location: 'New York', nickname: 'Giants', abbrev: 'NYG' }),
    team({ leagueId: 'nfl', location: 'Denver', nickname: 'Broncos', abbrev: 'DEN' }),
    team({ leagueId: 'nfl', location: 'Seattle', nickname: 'Seahawks', abbrev: 'SEA' }),
    team({ leagueId: 'nfl', location: 'Los Angeles', nickname: 'Rams', abbrev: 'LAR' }),
    team({ leagueId: 'nfl', location: 'Buffalo', nickname: 'Bills', abbrev: 'BUF' }),
  ],
  cfb: [
    team({ leagueId: 'cfb', location: 'Iowa', nickname: 'Hawkeyes', abbrev: 'IOWA' }),
    team({ leagueId: 'cfb', location: 'Washington', nickname: 'Huskies', abbrev: 'WASH' }),
    team({ leagueId: 'cfb', location: 'Nevada', nickname: 'Wolf Pack', abbrev: 'NEV' }),
    team({ leagueId: 'cfb', location: 'UTEP', nickname: 'Miners', abbrev: 'UTEP' }),
    team({ leagueId: 'cfb', location: 'Virginia Tech', nickname: 'Hokies', abbrev: 'VT' }),
    team({ leagueId: 'cfb', location: 'California', nickname: 'Golden Bears', abbrev: 'CAL' }),
    team({ leagueId: 'cfb', location: 'South Carolina', nickname: 'Gamecocks', abbrev: 'SC' }),
    team({ leagueId: 'cfb', location: 'Florida', nickname: 'Gators', abbrev: 'FLA' }),
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

describe('matchProgram (title + description fallback)', () => {
  it('uses the title when it resolves', () => {
    const r = matchProgram(dir, { title: 'Lakers @ Celtics' });
    expect(r.status).toBe('matched');
    expect(r.matchup?.leagueId).toBe('nba');
  });
  it('falls back to the description when the title is generic', () => {
    const r = matchProgram(dir, { title: 'NBA Playoffs', description: 'Lakers at Celtics' });
    expect(r.status).toBe('matched');
    expect([r.matchup?.away.abbrev, r.matchup?.home.abbrev]).toEqual(['LAL', 'BOS']);
  });
  it('does not match a prose description with no matchup shape', () => {
    const r = matchProgram(dir, { title: 'NBA Playoffs', description: 'Highlights of the Lakers and their season so far' });
    expect(r.matchup).toBeNull();
  });
  it('prefers the title when both resolve', () => {
    const r = matchProgram(dir, { title: 'Lakers @ Celtics', description: 'Cardinals vs Giants' });
    expect(r.matchup?.leagueId).toBe('nba');
  });
  it('returns no match when neither field has a matchup', () => {
    expect(matchProgram(dir, { title: 'SportsCenter', description: 'Daily highlights' }).matchup).toBeNull();
  });
});

// Real guide descriptions (provider sample, 2026-10-14): generic titles with the game in prose.
describe('matchProgram: games described in a sentence', () => {
  const desc = (title: string, description: string, channelName?: string) => matchProgram(dir, { title, description, channelName });
  const teams = (r: ReturnType<typeof matchProgram>) => r.matchup && [r.matchup.away.abbrev, r.matchup.separator, r.matchup.home.abbrev];

  it('"A at B from <venue>."', () => {
    expect(teams(desc('NBA Preseason Basketball', 'Toronto Raptors at New York Knicks from Madison Square Garden.'))).toEqual(['TOR', '@', 'NY']);
  });
  it('"The A visit the B in ..." is away at home', () => {
    expect(teams(desc('College Football', 'The Nevada Wolf Pack visit the UTEP Miners in a Mountain West Conference game. Nevada was idle in Week 5.'))).toEqual(['NEV', '@', 'UTEP']);
    expect(teams(desc('College Football', 'Virginia Tech visits California in an ACC game.'))).toEqual(['VT', '@', 'CAL']);
    expect(teams(desc('NBA Playoffs', 'The Lakers visit the Celtics tonight'))).toEqual(['LAL', '@', 'BOS']);
  });
  it('"The A face/meet/play the B ..." has no home side: vs', () => {
    expect(teams(desc('NFL Football', 'The Denver Broncos face the Seattle Seahawks during week six of the NFL.'))).toEqual(['DEN', 'vs', 'SEA']);
  });
  it('"A and B meet ..." with rankings and records', () => {
    expect(teams(desc('NFL Football', 'Los Angeles Rams and Buffalo Bills meet during week five of the NFL.'))).toEqual(['LAR', 'vs', 'BUF']);
    expect(teams(desc('College Football', 'The No. 20 Iowa Hawkeyes (4-1) and the Washington Huskies (3-2) meet in a Big Ten clash.'))).toEqual(['IOWA', 'vs', 'WASH']);
  });
  it('"No. 16" is not the end of a sentence', () => {
    expect(teams(desc('College Football', 'The South Carolina Gamecocks (2-3) play the No. 16 Florida Gators (4-1) at Ben Hill Griffin Stadium. The Gamecocks seek a win.'))).toEqual(['SC', 'vs', 'FLA']);
  });
  it('a sentence naming one team, or none, is not a game', () => {
    expect(desc('College Football', 'From Memorial Stadium in Lincoln, Neb.').matchup).toBeNull();
    expect(desc('NFL Football', 'Action from week 3 of the NFL season.').matchup).toBeNull();
    expect(desc('NHL Hockey', 'The Penguins face a tough road trip this week.').matchup).toBeNull();
  });
  it('a very long description without a game is handled quickly', () => {
    const long = `${'word and more words '.repeat(5000)}the end.`;
    const started = Date.now();
    expect(desc('College Football', long).matchup).toBeNull();
    expect(Date.now() - started).toBeLessThan(200);
  });
  it('a title split keeps its separator', () => {
    expect(teams(matchProgram(dir, { title: 'Pittsburgh Penguins at Chicago Blackhawks' }))).toEqual(['PIT', '@', 'CHI']);
    expect(teams(matchProgram(dir, { title: 'Lakers vs. Celtics' }))).toEqual(['LAL', 'vs', 'BOS']);
  });
});
