import { describe, it, expect } from 'vitest';
import { normalizeToken, detectLeagueHint, stripLeadingLabel, splitSides } from './normalize';

describe('normalizeToken', () => {
  it('lowercases, strips punctuation and accents, collapses spaces', () => {
    expect(normalizeToken('  Montréal  Canadiens! ')).toBe('montreal canadiens');
    expect(normalizeToken('St. Louis')).toBe('st louis');
  });
});

describe('detectLeagueHint', () => {
  it('detects from title prefix', () => {
    expect(detectLeagueHint('NBA: Lakers @ Celtics')).toBe('nba');
    expect(detectLeagueHint('College Basketball: Duke vs UNC')).toBe('cbb');
  });
  it('detects from channel name when title has none', () => {
    expect(detectLeagueHint('Lakers @ Celtics', 'NBA TV')).toBe('nba');
  });
  it('returns undefined when nothing matches', () => {
    expect(detectLeagueHint('Lakers @ Celtics')).toBeUndefined();
  });
});

describe('stripLeadingLabel', () => {
  it('removes a colon-delimited league/sport label', () => {
    expect(stripLeadingLabel('NBA: Lakers @ Celtics')).toBe('Lakers @ Celtics');
    expect(stripLeadingLabel('NFL Football: Chiefs at Bills')).toBe('Chiefs at Bills');
  });
  it('removes a dash-delimited league/sport label', () => {
    expect(stripLeadingLabel('MLB Baseball - Yankees at Red Sox')).toBe('Yankees at Red Sox');
  });
  it('does NOT strip when the prefix is a team (dash is the team separator)', () => {
    expect(stripLeadingLabel('Lakers - Celtics')).toBe('Lakers - Celtics');
  });
  it('leaves non-label colons alone', () => {
    expect(stripLeadingLabel('7:30 Lakers @ Celtics')).toBe('7:30 Lakers @ Celtics');
    expect(stripLeadingLabel('Lakers @ Celtics')).toBe('Lakers @ Celtics');
  });
});

describe('splitSides', () => {
  it('splits on @, vs, vs., versus, at, and dash variants', () => {
    expect(splitSides('Lakers @ Celtics')).toEqual(['Lakers', 'Celtics']);
    expect(splitSides('Lakers vs Celtics')).toEqual(['Lakers', 'Celtics']);
    expect(splitSides('Lakers vs. Celtics')).toEqual(['Lakers', 'Celtics']);
    expect(splitSides('Lakers versus Celtics')).toEqual(['Lakers', 'Celtics']);
    expect(splitSides('Chiefs at Bills')).toEqual(['Chiefs', 'Bills']);
    expect(splitSides('Lakers — Celtics')).toEqual(['Lakers', 'Celtics']);
  });
  it('returns null when there is no single separator', () => {
    expect(splitSides('SportsCenter')).toBeNull();
    expect(splitSides('A vs B vs C')).toBeNull();
  });
});
