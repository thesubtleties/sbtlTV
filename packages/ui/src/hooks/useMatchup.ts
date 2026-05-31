import { useEffect, useMemo } from 'react';
import type { StoredChannel, StoredProgram } from '../db';
import { useSportsMatchupEnabled, useDebugLoggingEnabled } from '../stores/uiStore';
import { getDirectory } from '../services/sports/teams-directory';
import { matchProgramToMatchup } from '../services/sports/matchup-matcher';
import type { Matchup } from '../services/sports/types';
import { debugLog } from '../utils/debugLog';

/** Returns a confident sports Matchup for the current live program, or null. Fail-silent. */
export function useMatchup(
  channel: StoredChannel | null,
  currentProgram: StoredProgram | null,
): Matchup | null {
  const enabled = useSportsMatchupEnabled();
  const debugEnabled = useDebugLoggingEnabled();
  const title = currentProgram?.title ?? '';
  const channelName = channel?.name;

  const result = useMemo(
    () => (enabled && title ? matchProgramToMatchup(getDirectory(), title, channelName) : null),
    [enabled, title, channelName],
  );

  // Log misses (game-like titles that didn't resolve) only when debugging — side
  // effect lives in an effect, not the memo, so it never double-fires under StrictMode.
  useEffect(() => {
    if (!debugEnabled || !result) return;
    if (result.status === 'unresolved' || result.status === 'ambiguous') {
      debugLog(`${result.status}: "${title}" (channel: ${channelName ?? '?'})`, 'matchup');
    }
  }, [debugEnabled, result, title, channelName]);

  return result?.status === 'matched' ? result.matchup : null;
}
