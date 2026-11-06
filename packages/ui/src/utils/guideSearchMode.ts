export type GuideSearchMode = 'search' | 'filter';
const KEY = 'guide-search-mode';

export function loadGuideSearchMode(): GuideSearchMode {
  try { return localStorage.getItem(KEY) === 'filter' ? 'filter' : 'search'; } catch { return 'search'; }
}
export function saveGuideSearchMode(mode: GuideSearchMode): void {
  try { localStorage.setItem(KEY, mode); } catch { /* the default next launch is fine */ }
}
