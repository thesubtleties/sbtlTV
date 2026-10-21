import { useEffect, useRef, useState } from 'react';
import { useSubtitleStore } from '../stores/subtitleStore';
import { usePlaybackStore } from '../stores/playbackStore';
import { heardAt, solveSync, type SyncPoint } from '../services/subtitleLogic';
import './SubtitlePicker.css';
import './SubtitleSync.css';

/** CC menu > Sync subtitles: tap the line you just heard; a second line later fixes drift. */
export function SubtitleSync() {
  const open = useSubtitleStore((s) => s.syncOpen);
  return open ? <SyncPanel /> : null;
}

function SyncPanel() {
  const [cues, setCues] = useState<Array<{ start: number; text: string }>>([]);
  const [focus, setFocus] = useState<number | null>(null);
  const [synced, setSynced] = useState(false);
  const moved = useRef(false);
  const points = useRef<SyncPoint[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // The lines around now, refreshed while playback goes on
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      const { generation, delay, speed, selectedId, downloaded } = useSubtitleStore.getState();
      const nId = selectedId !== null ? downloaded[selectedId]?.nId : undefined;
      if (!nId) return;
      const position = usePlaybackStore.getState().position;
      // Before the first tap the subtitle can be far off: a wide window; after it, the lines around now
      const span = points.current.length === 0 ? 300 : 60;
      void window.subdl?.cues(generation, nId, position, delay, speed, span).then((list) => {
        if (!alive) return;
        setCues(list);
        if (!moved.current) {
          // The last line that should have been heard by now (with the current timing)
          let last = 0;
          list.forEach((c, i) => { if (c.start * speed + delay <= position) last = i; });
          setFocus(list.length ? last : null);
        }
      });
    };
    refresh();
    const timer = setInterval(refresh, 500);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  function pick(i: number) {
    const cue = cues[i];
    if (!cue) return;
    const position = usePlaybackStore.getState().position;
    const store = useSubtitleStore.getState();
    points.current = [...points.current, { cueStart: cue.start, at: heardAt(position) }];
    // A subtitle that may be for another cut: its timing is a scene shift, never a speed
    const next = solveSync(points.current, store.speed, { speed: store.subdlStatus !== 'cut' });
    if (Math.abs(next.speed - store.speed) > 1e-6) store.setSpeed(next.speed);
    store.setDelay(next.delay);
    moved.current = false;
    setSynced(true);
    setTimeout(() => setSynced(false), 1500);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useSubtitleStore.getState().openSync(false);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        moved.current = true;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setFocus((f) => Math.min(Math.max((f ?? 0) + step, 0), Math.max(cues.length - 1, 0)));
      } else if (e.key === 'Enter' && focus !== null) pick(focus);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useEffect(() => {
    if (focus !== null) listRef.current?.querySelector<HTMLElement>(`[data-index="${focus}"]`)?.scrollIntoView({ block: 'center' });
  }, [focus]);

  const hint = synced ? 'Synced' : points.current.length > 0 ? 'Tap another line later to fix drift' : 'Tap the line you just heard';

  return (
    <div className="subsync" role="dialog" aria-label="Sync subtitles">
      <div className="subsync__head">
        <span className="subsync__title">Sync subtitles</span>
        <button className="subpick__close" onClick={() => useSubtitleStore.getState().openSync(false)} aria-label="Close">×</button>
      </div>
      <div className={`subsync__hint${synced ? ' subsync__hint--ok' : ''}`}>{hint}</div>
      <div className="subsync__list" ref={listRef} role="listbox">
        {cues.length === 0 && <div className="subpick__note">No spoken lines around here</div>}
        {cues.map((c, i) => (
          <button
            key={`${c.start}-${i}`}
            data-index={i}
            role="option"
            aria-selected={i === focus}
            className={`subsync__row${i === focus ? ' subsync__row--focus' : ''}`}
            onMouseEnter={() => { moved.current = true; setFocus(i); }}
            onClick={() => pick(i)}
          >
            {c.text}
          </button>
        ))}
      </div>
      <div className="subsync__foot">
        <button className="subsync__done" onClick={() => useSubtitleStore.getState().openSync(false)}>Close</button>
      </div>
    </div>
  );
}
