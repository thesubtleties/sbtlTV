import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { data } from '../data/client';
import { rematchFavorites } from '../services/sync/applyFavorites';

/**
 * Synced favorites from other computers are matched again when this computer's channels change:
 * a channel sync finishing, or a source added, turned on or off.
 */
export function useRematchFavorites(rematch: () => Promise<void> = rematchFavorites): void {
  const sourcesKey = useUIStore((s) => s.sources.map((x) => `${x.id}:${x.enabled ? 1 : 0}`).join(','));
  useEffect(() => { if (sourcesKey) void rematch().catch(() => {}); }, [sourcesKey, rematch]);
  useEffect(() => data.onSync((p) => { if (p.stage === 'channels' && p.state === 'finished') void rematch().catch(() => {}); }), [rematch]);
}
