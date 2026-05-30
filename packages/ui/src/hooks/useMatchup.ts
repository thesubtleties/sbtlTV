import { useMemo } from 'react';
import type { StoredChannel, StoredProgram } from '../db';
import { useUIStore } from '../stores/uiStore';
import { getDirectory } from '../services/sports/teams-directory';
import { matchProgramToMatchup } from '../services/sports/matchup-matcher';
import type { Matchup } from '../services/sports/types';
import { debugLog } from '../utils/debugLog';

/**
 * Returns a confident sports Matchup for the channel's current program, or null.
 * Pure/derived (memoized on title + channel name + flags). Fails silent; logs only
 * titles that looked game-like but didn't confidently resolve, and only when debug
 * logging is enabled.
 */
export function useMatchup(
  channel: StoredChannel | null,
  currentProgram: StoredProgram | null,
): Matchup | null {
  const enabled = useUIStore((s) => s.settings.sportsMatchupEnabled ?? true);
  const debugEnabled = useUIStore((s) => s.settings.debugLoggingEnabled ?? false);
  const title = currentProgram?.title ?? '';
  const channelName = channel?.name;

  return useMemo(() => {
    if (!enabled || !title) return null;
    const result = matchProgramToMatchup(getDirectory(), title, channelName);
    if (result.status === 'matched') return result.matchup;
    if (debugEnabled && (result.status === 'unresolved' || result.status === 'ambiguous')) {
      debugLog(`[matchup] ${result.status}: "${title}" (channel: ${channelName ?? '?'})`, 'matchup');
    }
    return null;
  }, [enabled, debugEnabled, title, channelName]);
}
