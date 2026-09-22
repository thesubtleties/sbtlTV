import { describe, it, expect } from 'vitest';
import { normalizeTitle, extractMatchParams } from './tmdb-exports';

describe('normalizeTitle', () => {
  describe('provider language prefixes', () => {
    it('strips "ES - " prefix', () => {
      expect(normalizeTitle('ES - Miss Potter')).toBe('miss potter');
    });

    it('strips "EN - " prefix', () => {
      expect(normalizeTitle('EN - The Matrix')).toBe('the matrix');
    });

    it('strips "4K-ES - " prefix', () => {
      expect(normalizeTitle('4K-ES - Avengers Endgame')).toBe('avengers endgame');
    });

    it('strips "HD-EN - " prefix', () => {
      expect(normalizeTitle('HD-EN - Inception')).toBe('inception');
    });

    it('strips "4K - " prefix without language', () => {
      expect(normalizeTitle('4K - Avatar')).toBe('avatar');
    });

    it('handles various dash styles (en-dash, em-dash)', () => {
      expect(normalizeTitle('ES – Movie Title')).toBe('movie title');
      expect(normalizeTitle('ES — Movie Title')).toBe('movie title');
    });
  });

  describe('trailing language tags', () => {
    it('strips "(ES)" suffix', () => {
      expect(normalizeTitle('All American (ES)')).toBe('all american');
    });

    it('strips "[EN]" suffix', () => {
      expect(normalizeTitle('Breaking Bad [EN]')).toBe('breaking bad');
    });

    it('strips "(US)" suffix', () => {
      expect(normalizeTitle('The Office (US)')).toBe('the office');
    });
  });

  describe('year patterns', () => {
    it('strips year in parentheses', () => {
      expect(normalizeTitle('The Matrix (1999)')).toBe('the matrix');
    });

    it('strips year in brackets', () => {
      expect(normalizeTitle('The Matrix [1999]')).toBe('the matrix');
    });

    it('strips trailing year', () => {
      expect(normalizeTitle('The Matrix 1999')).toBe('the matrix');
    });
  });

  describe('quality markers', () => {
    it('strips quality markers from middle of title', () => {
      expect(normalizeTitle('Movie 1080p BluRay')).toBe('movie');
    });

    it('handles dot-separated quality markers', () => {
      expect(normalizeTitle('The.Matrix.1999.1080p.BluRay')).toBe('the matrix');
    });
  });

  describe('combined patterns', () => {
    it('handles prefix + year', () => {
      expect(normalizeTitle('ES - Miss Potter (2006)')).toBe('miss potter');
    });

    it('handles prefix + quality + year', () => {
      expect(normalizeTitle('4K-ES - Avengers Endgame (2019) 2160p')).toBe('avengers endgame');
    });

    it('handles suffix + year', () => {
      expect(normalizeTitle('The Office (2005) (US)')).toBe('the office');
    });
  });

  describe('edge cases - should preserve', () => {
    it('preserves language codes in middle of title', () => {
      expect(normalizeTitle('The US vs John Lennon')).toBe('the us vs john lennon');
    });

    it('preserves titles without prefixes/suffixes', () => {
      expect(normalizeTitle('Captain America')).toBe('captain america');
    });

    it('handles titles with apostrophes', () => {
      // Apostrophe becomes space - both sides should normalize the same way
      expect(normalizeTitle("Ocean's Eleven")).toBe('ocean s eleven');
    });

    it('handles empty string', () => {
      expect(normalizeTitle('')).toBe('');
    });

    it('handles whitespace-only string', () => {
      expect(normalizeTitle('   ')).toBe('');
    });
  });
});

describe('extractMatchParams', () => {
  it('uses title and year fields when both present', () => {
    const result = extractMatchParams({ name: 'Whatever', title: 'The Matrix', year: '1999' });
    expect(result).toEqual({ title: 'The Matrix', year: 1999 });
  });

  it('extracts year from name when title present but year missing', () => {
    const result = extractMatchParams({ name: 'The Matrix (1999)', title: 'The Matrix' });
    expect(result).toEqual({ title: 'The Matrix', year: 1999 });
  });

  it('parses title and year from name pattern', () => {
    const result = extractMatchParams({ name: 'The Matrix (1999)' });
    expect(result).toEqual({ title: 'The Matrix', year: 1999 });
  });

  it('falls back to name as title when no pattern matches', () => {
    const result = extractMatchParams({ name: 'The Matrix' });
    expect(result).toEqual({ title: 'The Matrix' });
  });

  it('handles invalid year gracefully', () => {
    const result = extractMatchParams({ name: 'Movie', title: 'Movie', year: 'invalid' });
    expect(result).toEqual({ title: 'Movie', year: undefined });
  });
});
