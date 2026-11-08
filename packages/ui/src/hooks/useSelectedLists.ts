import { useEffect, useState } from 'react';
import type { VodType } from '../types/media';
import type { SelectedList } from '../types/electron';
import { useSelectedListsEnabled } from '../stores/uiStore';

/** Today's Selected lists for this home (main keeps the verified copy and refreshes it daily). */
export function useSelectedLists(type: VodType): SelectedList[] {
  const enabled = useSelectedListsEnabled();
  const [lists, setLists] = useState<SelectedList[]>([]);
  useEffect(() => {
    const api = window.selectedLists;
    if (!enabled || !api) { setLists([]); return; }
    let live = true;
    const load = () => {
      api.get()
        .then((all) => { if (live) setLists(type === 'movie' ? all.movies : all.series); })
        .catch(() => { if (live) setLists([]); });
    };
    load();
    const off = api.onUpdated(load);
    return () => { live = false; off(); };
  }, [enabled, type]);
  return lists;
}
