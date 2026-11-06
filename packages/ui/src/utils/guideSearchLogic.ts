import { isAiringLive, type GuideAiring } from '@sbtltv/core';
import type { GuideItem } from '../components/GuideSearchResults';

/** Up and Down through the rows; -1 is back in the box, with nothing highlighted. */
export function moveActive(index: number, key: 'ArrowUp' | 'ArrowDown', count: number): number {
  return Math.max(-1, Math.min(count - 1, index + (key === 'ArrowDown' ? 1 : -1)));
}

/** Right and Left on a row with feeds: which row to leave open. undefined = the caret's key. */
export function feedsAfterKey(item: GuideItem | undefined, key: 'ArrowLeft' | 'ArrowRight'): string | null | undefined {
  if (item?.kind !== 'airing' || item.airing.channels.length < 2) return undefined;
  return key === 'ArrowRight' ? item.airing.key : null;
}

/** What Enter acts on: never results for what was typed a moment ago. */
export function enterItem(items: GuideItem[], activeIndex: number, pending: boolean): GuideItem | null {
  if (pending) return null;
  return items[activeIndex] ?? items[0] ?? null;
}

/** What picking an airing's row does: on now it plays or offers its feeds, later it jumps. */
export function airingAction(airing: GuideAiring, nowMs: number): 'feeds' | 'play' | 'jump' {
  if (!isAiringLive(airing, nowMs)) return 'jump';
  return airing.channels.length > 1 ? 'feeds' : 'play';
}

/** The left edge of the guide for a jump: the half hour the airing starts in. */
export function jumpAnchor(startMs: number): Date {
  const start = new Date(startMs);
  start.setMinutes(start.getMinutes() < 30 ? 0 : 30, 0, 0);
  return start;
}

export interface SearchRead { text: string; settled: string; active: boolean; stale: boolean; loading: boolean; hasData: boolean; error: boolean }

/** Nothing may act on results while `pending`; `failed` is about the search on screen. */
export function searchStatus(r: SearchRead): { pending: boolean; failed: boolean } {
  return { pending: r.text !== r.settled || r.stale || (r.loading && !r.hasData), failed: r.error };
}
