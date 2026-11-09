/**
 * What an open series page knows about its episode fetches, one entry per related
 * series (one per source). Pure, so the rules are tested without React.
 *
 * - fetching: asked and the data process queued it; until it ends, an empty
 *   page means "loading", not "no episodes".
 * - issues: the last fetch for that series came back empty or failed. With a
 *   stored list the page keeps it and shows a warning; with nothing stored it
 *   shows the problem in place of the list. A later fetch with episodes clears it.
 */
import type { SyncProgress } from '@sbtltv/core';

export interface EpisodeIssue {
  seriesId: string;
  sourceId: string;
  kind: 'empty' | 'failed';
  message?: string;
}

export interface EpisodeFetchState {
  fetching: { seriesId: string; sourceId: string }[];
  issues: EpisodeIssue[];
}

export type EpisodeFetchAction =
  | { type: 'reset' }
  | { type: 'queued'; seriesId: string; sourceId: string }
  | { type: 'progress'; progress: SyncProgress }
  | { type: 'timeout' };

export const EPISODE_FETCH_TIMEOUT_MS = 30_000;
export const NO_ANSWER_MESSAGE = 'No answer from the provider yet';

export const initialEpisodeFetchState: EpisodeFetchState = { fetching: [], issues: [] };

function withIssue(issues: EpisodeIssue[], issue: EpisodeIssue): EpisodeIssue[] {
  return [...issues.filter((i) => i.seriesId !== issue.seriesId), issue];
}

export function episodeFetchReducer(state: EpisodeFetchState, action: EpisodeFetchAction): EpisodeFetchState {
  switch (action.type) {
    case 'reset':
      return initialEpisodeFetchState;
    case 'queued':
      if (state.fetching.some((f) => f.seriesId === action.seriesId)) return state;
      return { ...state, fetching: [...state.fetching, { seriesId: action.seriesId, sourceId: action.sourceId }] };
    case 'progress': {
      const p = action.progress;
      if (p.stage !== 'episodes' || !p.seriesId || p.state === 'started') return state;
      const seriesId = p.seriesId;
      const fetching = state.fetching.filter((f) => f.seriesId !== seriesId);
      if (p.state === 'failed') {
        return { fetching, issues: withIssue(state.issues, { seriesId, sourceId: p.sourceId, kind: 'failed', message: p.message }) };
      }
      if ((p.counts?.episodes ?? 1) === 0) {
        return { fetching, issues: withIssue(state.issues, { seriesId, sourceId: p.sourceId, kind: 'empty' }) };
      }
      return { fetching, issues: state.issues.filter((i) => i.seriesId !== seriesId) };
    }
    case 'timeout':
      if (state.fetching.length === 0) return state;
      return {
        fetching: [],
        issues: state.fetching.reduce((acc, f) => withIssue(acc, { ...f, kind: 'failed', message: NO_ANSWER_MESSAGE }), state.issues),
      };
  }
}

/** The message shown in place of the list when nothing is stored, or null. */
export function blockingMessage(issues: EpisodeIssue[], sourceName: (id: string) => string): string | null {
  if (issues.length === 0) return null;
  const failed = issues.find((i) => i.kind === 'failed');
  if (failed) return failed.message || `Couldn't load episodes from ${sourceName(failed.sourceId)}`;
  return `${namesOf(issues, sourceName)} sent no episodes`;
}

/** The short warning beside the season picker when a stored list is kept. */
export function warningText(issues: EpisodeIssue[], sourceName: (id: string) => string): string | null {
  if (issues.length === 0) return null;
  const failed = issues.filter((i) => i.kind === 'failed');
  const empty = issues.filter((i) => i.kind === 'empty');
  const parts: string[] = [];
  if (failed.length) parts.push(`Couldn't refresh from ${namesOf(failed, sourceName)}`);
  if (empty.length) parts.push(`${namesOf(empty, sourceName)} sent no episodes`);
  return parts.join('. ');
}

function namesOf(issues: EpisodeIssue[], sourceName: (id: string) => string): string {
  return [...new Set(issues.map((i) => sourceName(i.sourceId)))].join(', ');
}
