import { LEAGUES } from './leagues';
import type { LeagueId } from './types';

/** Lowercase, strip diacritics, drop punctuation, collapse whitespace. */
export function normalizeToken(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// (leagueId, normalized token) pairs, longest token first so
// "college basketball" wins over a bare "basketball" substring.
const LEAGUE_TOKENS: Array<{ id: LeagueId; token: string }> = LEAGUES.flatMap((l) =>
  l.titleTokens.map((t) => ({ id: l.id, token: normalizeToken(t) })),
).sort((a, b) => b.token.length - a.token.length);

/** Detect a league hint from the EPG title and/or channel name. */
export function detectLeagueHint(title: string, channelName?: string): LeagueId | undefined {
  const padded = ` ${normalizeToken(`${title} ${channelName ?? ''}`)} `;
  for (const { id, token } of LEAGUE_TOKENS) {
    if (padded.includes(` ${token} `)) return id;
  }
  return undefined;
}

const SPORT_LABEL_WORDS = new Set([
  'football', 'basketball', 'baseball', 'hockey', 'soccer',
  'ncaa', 'ncaaf', 'ncaab', 'college', 'nfl', 'nba', 'mlb', 'nhl', 'cfb', 'cbb', 'mens', 'womens',
]);

/**
 * Strip a leading "Label:" or "Label - " segment IFF the label is only
 * sport/league words. The dash form is handled carefully because a spaced
 * dash is also the team separator ("Lakers - Celtics") — we only strip it
 * when the first segment is entirely sport words ("MLB Baseball - ...").
 */
export function stripLeadingLabel(title: string): string {
  const colonIdx = title.indexOf(':');
  const dashMatch = title.match(/\s[-–—]\s/);
  const dashIdx = dashMatch?.index ?? -1;

  let cut = -1;
  let after = '';
  if (colonIdx !== -1 && (dashIdx === -1 || colonIdx < dashIdx)) {
    cut = colonIdx;
    after = title.slice(colonIdx + 1).trim();
  } else if (dashIdx !== -1) {
    cut = dashIdx;
    after = title.slice(dashIdx + dashMatch![0].length).trim();
  }
  if (cut === -1) return title;

  const label = normalizeToken(title.slice(0, cut));
  if (label && label.split(' ').every((w) => SPORT_LABEL_WORDS.has(w))) {
    return after;
  }
  return title;
}

// Separator between the two sides; spaces required so hyphenated names survive.
const SPLIT_RE = /\s+(?:@|vs\.?|versus|at|[-–—])\s+/i;

/** Split "A vs B" / "A @ B" into [a, b]; null if not exactly two sides. */
export function splitSides(title: string): [string, string] | null {
  const parts = title.split(SPLIT_RE);
  if (parts.length !== 2) return null;
  const a = parts[0].trim();
  const b = parts[1].trim();
  if (!a || !b) return null;
  return [a, b];
}
