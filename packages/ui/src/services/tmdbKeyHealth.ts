/**
 * Stops TMDB requests when TMDB keeps saying the key is bad. Only TMDB's own "invalid / suspended
 * key" answers count; network errors, rate limits and outages never do. After REJECTIONS_TO_STOP in
 * a row the key is set aside for the session: every TMDB call fails at once (no request), Settings >
 * TMDB says so, and one toast tells the user. The saved key is never touched: a new key or a
 * restart tries again.
 */
import { create } from 'zustand';
import { debugLog } from '../utils/debugLog';
import { useToastStore } from '../stores/toastStore';

export const REJECTIONS_TO_STOP = 3;
/** TMDB status_code values that mean the key itself is refused (7 invalid, 10 suspended). */
const KEY_REFUSED_CODES = new Set([7, 10]);

export function isKeyRefused(err: unknown): boolean {
  const code = (err as { status_code?: unknown } | null)?.status_code;
  return typeof code === 'number' && KEY_REFUSED_CODES.has(code);
}

interface KeyHealth {
  rejections: number;
  stopped: boolean;
}

export const useTmdbKeyHealth = create<KeyHealth>(() => ({ rejections: 0, stopped: false }));

export class TmdbKeyStoppedError extends Error {
  constructor() { super('TMDB key set aside after repeated rejections'); }
}

export function tmdbKeyStopped(): boolean {
  return useTmdbKeyHealth.getState().stopped;
}

/** Call with every TMDB answer: `undefined` for a success, the rejection otherwise. */
export function noteTmdbResult(err: unknown): void {
  const { rejections, stopped } = useTmdbKeyHealth.getState();
  if (stopped) return;
  if (err === undefined) {
    if (rejections) useTmdbKeyHealth.setState({ rejections: 0 });
    return;
  }
  if (!isKeyRefused(err)) return;
  const next = rejections + 1;
  if (next < REJECTIONS_TO_STOP) {
    useTmdbKeyHealth.setState({ rejections: next });
    return;
  }
  useTmdbKeyHealth.setState({ rejections: next, stopped: true });
  debugLog('TMDB refused the access token repeatedly; TMDB requests stopped until the token changes or the app restarts', 'tmdb');
  useToastStore.getState().addToast({
    kind: 'error',
    title: 'TMDB rejected your access token',
    message: 'Check it in Settings > TMDB.',
    duration: 8000,
  });
}

/** A new key (or a restart) gets a fresh start. */
export function resetTmdbKeyHealth(): void {
  useTmdbKeyHealth.setState({ rejections: 0, stopped: false });
}
