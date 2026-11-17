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

/** The newest list for a version up to `current` (a patch release shows its release's list); null if none. */
export function latestList(items: Record<string, WhatsNewItem[]>, current: string, after?: string): WhatsNewItem[] | null {
  const top = baseVersion(current);
  const keys = Object.keys(items)
    .filter((k) => items[k].length > 0 && compareVersions(k, top) <= 0 && (after === undefined || compareVersions(k, baseVersion(after)) > 0))
    .sort(compareVersions);
  return keys.length ? items[keys[keys.length - 1]] : null;
}

/** The items to show after an update, or null: the newest list not seen yet. Betas share their release's list, so it shows once. */
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
  return latestList(s.items, s.current, s.lastSeen);
}

/**
 * What a launch does with What's new: show the list, or (a release with nothing to show, outside the
 * first run) just record the version so the next update compares from here.
 */
export function whatsNewOnLaunch(s: Parameters<typeof whatsNewToShow>[0]): { show: WhatsNewItem[] } | 'record' | null {
  const items = whatsNewToShow(s);
  if (items) return { show: items };
  // Never on a beta: its list may only arrive in a later beta, and recording it would skip that list for good
  return s.buildKind === 'release' && s.firstRun === null && s.lastSeen !== s.current && !s.current.includes('-') ? 'record' : null;
}
