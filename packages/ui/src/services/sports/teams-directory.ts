import type { LeagueId, Team, TeamsData } from './types';
import { COLLEGE_LEAGUES } from './leagues';
import { normalizeToken } from './normalize';

export interface Directory {
  /** normalized key -> teams that match it (collisions span leagues) */
  byKey: Map<string, Team[]>;
}

function keysForTeam(t: Team): string[] {
  const keys = [t.displayName, t.nickname, `${t.location} ${t.nickname}`, t.abbrev, ...t.aliases];
  // Bare school name is a safe key only for college (one program per location).
  if (COLLEGE_LEAGUES.has(t.leagueId)) keys.push(t.location);
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
