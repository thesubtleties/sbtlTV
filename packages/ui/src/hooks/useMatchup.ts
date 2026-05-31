import { useEffect, useMemo } from 'react';
import type { StoredChannel, StoredProgram } from '../db';
import { useSportsMatchupEnabled, useDebugLoggingEnabled } from '../stores/uiStore';
import { getDirectory } from '../services/sports/teams-directory';
import { matchProgram } from '../services/sports/matchup-matcher';
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
  const description = currentProgram?.description ?? '';
  const channelName = channel?.name;

  const result = useMemo(
    () => (enabled ? matchProgram(getDirectory(), { title, description, channelName }) : null),
    [enabled, title, description, channelName],
  );

  // Log game-like-but-unresolved programs only when debugging — helps tune the matcher.
  useEffect(() => {
    if (!debugEnabled || !result) return;
    if (result.status === 'unresolved' || result.status === 'ambiguous') {
      debugLog(`${result.status}: title="${title}" desc="${description}" (ch: ${channelName ?? '?'})`, 'matchup');
    }
  }, [debugEnabled, result, title, description, channelName]);

  return result?.status === 'matched' ? result.matchup : null;
}
