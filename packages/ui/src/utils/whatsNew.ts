import type { FirstRunMode } from './firstRun';
import type { WhatsNewItem } from '../whatsNewItems';

export const baseVersion = (v: string): string => v.split('-')[0];

function parse(v: string): { nums: number[]; pre: (string | number)[] | null } {
  const dash = v.indexOf('-');
  const main = dash < 0 ? v : v.slice(0, dash);
  const pre = dash < 0 ? '' : v.slice(dash + 1);
  return { nums: main.split('.').map((n) => Number(n) || 0), pre: pre ? pre.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : null };
}

/** Semver order: numbers first, then a prerelease sorts before its release (0.17.0-beta.1 < 0.17.0). */
export function compareVersions(a: string, b: string): number {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
  if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p - q;
    return String(p) < String(q) ? -1 : 1;
  }
  return 0;
}

/** The items to show after an update, or null. Betas share their release's list, so it shows once. */
export function whatsNewToShow(s: {
  current: string;
  lastSeen: string | undefined;
  buildKind: 'release' | 'test' | 'local';
  hasSources: boolean;
  firstRun: FirstRunMode;
  items: Record<string, WhatsNewItem[]>;
}): WhatsNewItem[] | null {
  if (s.buildKind !== 'release' || s.firstRun !== null) return null;
  if (s.lastSeen === undefined && !s.hasSources) return null;
  if (s.lastSeen !== undefined && compareVersions(baseVersion(s.current), baseVersion(s.lastSeen)) <= 0) return null;
  const list = s.items[baseVersion(s.current)];
  return list && list.length > 0 ? list : null;
}
