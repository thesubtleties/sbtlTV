/** Title normalisation and match parameters for TMDB matching (the titles cache lives in @sbtltv/data). */

// Parameters extracted from VOD item for matching
export interface MatchParams {
  title: string;
  year?: number;
}

// Language/country codes commonly used by providers
const LANG_CODES = 'ES|EN|DE|FR|IT|PT|RU|JP|KR|CN|US|UK|MX|AR|BR|NL|PL|TR|IN|AU|CA';
// Built once: normalizeTitle runs over every line of the TMDB export (1.2M+ titles per load).
const QUALITY_LANG_PREFIX = new RegExp(`^(4k|hd|sd|uhd)[-\\s]*(${LANG_CODES})?\\s*[-–—]\\s*`, 'i');
const LANG_PREFIX = new RegExp(`^(${LANG_CODES})\\s*[-–—]\\s*`, 'i');
const LANG_SUFFIX = new RegExp(`\\s*[\\(\\[](${LANG_CODES})[\\)\\]]\\s*$`, 'i');

/**
 * Normalize title for matching (provider titles and TMDB export titles alike)
 * Strips provider prefixes (ES -, 4K-ES -, etc.) and language suffixes ((ES), [EN], etc.)
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    // Remove leading quality+language prefixes: "4K-ES - ", "HD-EN - ", "4K - ", etc.
    .replace(QUALITY_LANG_PREFIX, '')
    // Remove leading language prefixes: "ES - ", "EN - ", etc.
    .replace(LANG_PREFIX, '')
    // Remove trailing language tags: "(ES)", "[EN]", etc.
    .replace(LANG_SUFFIX, '')
    // Remove year patterns (parentheses/brackets)
    .replace(/\s*\(\d{4}\)\s*/g, ' ')
    .replace(/\s*\[\d{4}\]\s*/g, ' ')
    // Remove special chars (dots, dashes become spaces)
    .replace(/[^\w\s]/g, ' ')
    // Remove quality markers (including 2160p)
    .replace(/\s*(4k|uhd|hd|sd|2160p|1080p|720p|480p|bluray|blu-ray|web-dl|webrip|hdrip|dvdrip|brrip|hdtv)\s*/gi, ' ')
    // Remove trailing year (after special chars converted to spaces)
    .replace(/\s+\d{4}\s*$/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract title and year from VOD item for TMDB matching
 * Priority: title+year fields → parse from name → name only
 */
export function extractMatchParams(item: { name: string; title?: string; year?: string }): MatchParams {
  // 1. Best case: structured fields from Xtream API
  if (item.title && item.year) {
    const year = parseInt(item.year, 10);
    return {
      title: item.title,
      year: !isNaN(year) ? year : undefined,
    };
  }

  // 2. Has title but no year - check if name has (YEAR) pattern
  if (item.title) {
    const yearMatch = item.name.match(/\((\d{4})\)/);
    return {
      title: item.title,
      year: yearMatch ? parseInt(yearMatch[1], 10) : undefined,
    };
  }

  // 3. No title field - parse from name: "Movie Title (1962)"
  const nameMatch = item.name.match(/^(.+?)\s*\((\d{4})\)\s*$/);
  if (nameMatch) {
    return {
      title: nameMatch[1].trim(),
      year: parseInt(nameMatch[2], 10),
    };
  }

  // 4. Fallback: just use name as title, no year
  return { title: item.name };
}
