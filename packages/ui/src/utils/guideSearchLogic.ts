import { isAiringLive, type GuideAiring } from '@sbtltv/core';
import type { GuideItem } from '../components/GuideSearchResults';

/** Up and Down through the rows; null is back in the box, with nothing highlighted. */
export function moveActive(activeId: string | null, key: 'ArrowUp' | 'ArrowDown', items: GuideItem[]): string | null {
  const at = items.findIndex((i) => i.id === activeId);
  if (at < 0) return key === 'ArrowDown' ? items[0]?.id ?? null : null;
  const next = at + (key === 'ArrowDown' ? 1 : -1);
  return next < 0 ? null : items[Math.min(next, items.length - 1)].id;
}

/** Right opens a row with feeds or other airings, Left closes what's open. undefined = the caret's key. */
export function expandAfterKey(item: GuideItem | undefined, key: 'ArrowLeft' | 'ArrowRight', expandedKey: string | null): string | null | undefined {
  if (key === 'ArrowLeft') return expandedKey !== null && item ? null : undefined;
  if (item?.kind !== 'airing' || (item.airing.channels.length < 2 && !item.airing.more?.length)) return undefined;
  return item.airing.key;
}

/** What Enter acts on: never results for what was typed a moment ago, nor a row that has gone. */
export function enterItem(items: GuideItem[], activeId: string | null, pending: boolean): GuideItem | null {
  if (pending) return null;
  if (activeId === null) return items[0] ?? null;
  return items.find((i) => i.id === activeId) ?? null;
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
  return { pending: r.text !== r.settled || r.stale || (r.loading && !r.hasData), failed: r.active && r.error };
}
