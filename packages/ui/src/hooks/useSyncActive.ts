import { useEffect, useState } from 'react';

/** True while this computer is syncing (Settings > Sync & transfer > Sync). */
export function useSyncActive(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!window.sync) return;
    let live = true;
    void window.sync.view().then((v) => { if (live) setOn(v.status === 'active'); });
    const off = window.sync.onView((v) => setOn(v.status === 'active'));
    return () => { live = false; off(); };
  }, []);
  return on;
}
