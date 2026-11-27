import { normalizeTitle } from '@sbtltv/core';
import type { Db } from './platform.js';
import { titleTable, type TitleKind } from './tmdb-store.js';

export interface TitleHit { id: number; popularity: number }

// The old in-memory findBestMatch as two indexed lookups, same results: with a year, the first hit of that year in file
// order (Array.find); otherwise the most popular, the earlier line on a tie (reduce with a strict >). A leading "the "
// is retried only when the full title found nothing.
export function titleMatcher(db: Db, kind: TitleKind): (title: string, year?: number) => TitleHit | null {
  const table = titleTable(kind);
  const byYear = db.prepare(`select id, popularity from ${table} where norm = ? and year = ? order by rowid limit 1`);
  const best = db.prepare(`select id, popularity from ${table} where norm = ? order by popularity desc, rowid asc limit 1`);
  const hit = (row: unknown): TitleHit | null => (row ? { id: (row as TitleHit).id, popularity: (row as TitleHit).popularity } : null);
  const look = (norm: string, year?: number): TitleHit | null => (year ? hit(byYear.get(norm, year)) : null) ?? hit(best.get(norm));
  return (title, year) => {
    const norm = normalizeTitle(title);
    if (!norm) return null;
    const found = look(norm, year);
    if (found) return found;
    const withoutThe = norm.replace(/^the\s+/, '');
    return withoutThe !== norm ? look(withoutThe, year) : null;
  };
}
