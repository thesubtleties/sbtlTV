import type { LeagueId, Team, TeamsData } from './types';
import { COLLEGE_LEAGUES } from './leagues';
import { normalizeToken } from './normalize';
import { TEAMS_DATA } from './teams-data';

export interface Directory {
  /** normalized key -> teams that match it (collisions span leagues) */
  byKey: Map<string, Team[]>;
}

// Known ambiguous city <-> abbreviation pairs. Applied ONLY to a team whose
// `location` is one of these (never to arbitrary input), so "LA Tech" is never
// expanded to "Los Angeles Tech". Bidirectional: covers EPGs that write "LA
// Lakers" (ESPN stores "Los Angeles") and "Los Angeles Clippers" (ESPN: "LA").
const CITY_EQUIV: Record<string, string> = {
  'los angeles': 'la',
  la: 'los angeles',
};

function keysForTeam(t: Team): string[] {
  const keys = [t.displayName, t.nickname, `${t.location} ${t.nickname}`, t.abbrev];
  // Bare school name is a safe key only for college (one program per location).
  if (COLLEGE_LEAGUES.has(t.leagueId)) keys.push(t.location);
  // City-abbreviation equivalence for known ambiguous cities (e.g. LA teams).
  const equiv = CITY_EQUIV[normalizeToken(t.location)];
  if (equiv) keys.push(`${equiv} ${t.nickname}`);
  return keys.map(normalizeToken).filter((k) => k.length >= 2);
}

export function buildDirectory(data: TeamsData): Directory {
  const byKey = new Map<string, Team[]>();
  for (const league of Object.keys(data)) {
    for (const t of data[league]) {
      for (const key of keysForTeam(t)) {
        const arr = byKey.get(key) ?? [];
        if (!arr.includes(t)) arr.push(t);
        byKey.set(key, arr);
      }
    }
  }
  return { byKey };
}

/** Strip noise that real EPG titles add around a team name. */
function cleanSideName(raw: string): string {
  return raw
    .replace(/^\s*#\d+\s+/, '') // leading rank "#1 "
    .replace(/\([^)]*\)/g, ' ') // parentheticals "(OH)", "(FL)"
    .trim();
}

/** Exact (normalized) lookup. Optional league hint narrows collisions. */
export function resolveTeam(dir: Directory, rawName: string, leagueHint?: LeagueId): Team[] {
  const hits = dir.byKey.get(normalizeToken(cleanSideName(rawName))) ?? [];
  if (leagueHint) {
    const filtered = hits.filter((t) => t.leagueId === leagueHint);
    if (filtered.length > 0) return filtered;
  }
  return hits;
}

let cached: Directory | null = null;

/** Lazily build the directory from the bundled, generated team data. */
export function getDirectory(): Directory {
  if (!cached) cached = buildDirectory(TEAMS_DATA);
  return cached;
}
