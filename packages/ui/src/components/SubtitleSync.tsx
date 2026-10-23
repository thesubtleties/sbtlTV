import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSubtitleStore } from '../stores/subtitleStore';
import { usePlaybackStore } from '../stores/playbackStore';
import { heardAt, solveSync, stepSyncFocus, syncCueKey, type SyncCue, type SyncPoint } from '../services/subtitleLogic';
import './SubtitlePicker.css';
import './SubtitleSync.css';

/** CC menu > Sync subtitles: tap the line you just heard; a second line later fixes drift. */
export function SubtitleSync() {
  const open = useSubtitleStore((s) => s.syncOpen);
  return open ? <SyncPanel /> : null;
}

function SyncPanel() {
  const [cues, setCues] = useState<SyncCue[]>([]);
  // The focused line by its key, not its row: the list slides as playback goes on
  const [focus, setFocus] = useState<string | null>(null);
  const focusRef = useRef<string | null>(null);
  focusRef.current = focus;
  const [synced, setSynced] = useState(false);
  const moved = useRef(false);
  const points = useRef<SyncPoint[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusedOnce = useRef(false);
  const rowFor = (key: string | null) =>
    key === null ? undefined : [...(listRef.current?.querySelectorAll<HTMLElement>('[data-key]') ?? [])].find((el) => el.dataset.key === key);

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
        // Follow playback until the user moves; a line they moved to that slid out of the list hands back to playback
        if (!moved.current || !list.some((c) => syncCueKey(c) === focusRef.current)) {
          moved.current = false;
          // The last line that should have been heard by now (with the current timing)
          let last = 0;
          list.forEach((c, i) => { if (c.start * speed + delay <= position) last = i; });
          setFocus(list.length ? syncCueKey(list[last]) : null);
        }
      });
    };
    refresh();
    const timer = setInterval(refresh, 500);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  function pick(cue: SyncCue) {
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

  // Focus moves into the panel (first lines in view) and back to the CC button when it closes
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('.subsync__done')?.focus();
    return () => { (document.querySelector<HTMLElement>('.cc__arrow') ?? opener)?.focus?.(); };
  }, []);
  useEffect(() => {
    if (focusedOnce.current || focus === null) return;
    focusedOnce.current = true;
    rowFor(focus)?.focus();
  }, [focus]);

  // Up/Down move between lines, Esc closes (after the CC menu, if open); Enter is the focused line's own (pick)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.querySelector('.cc__menu')) return;
        useSubtitleStore.getState().openSync(false);
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (e.target as HTMLElement | null)?.dataset?.key !== undefined) {
        moved.current = true;
        const next = stepSyncFocus(cues, focus, e.key === 'ArrowDown' ? 1 : -1);
        setFocus(next);
        rowFor(next)?.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('button') ?? [])].filter((el) => el.tabIndex >= 0);
    if (items.length === 0) return;
    if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items[items.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === items[items.length - 1]) { e.preventDefault(); items[0].focus(); }
  };

  useEffect(() => {
    rowFor(focus)?.scrollIntoView({ block: 'center' });
  }, [focus]);

  const hint = synced ? 'Synced' : points.current.length > 0 ? 'Tap another line later to fix drift' : 'Tap the line you just heard';

  return (
    <div className="subsync" role="dialog" aria-label="Sync subtitles" ref={panelRef} onKeyDown={trapTab}>
      <div className="subsync__head">
        <span className="subsync__title">Sync subtitles</span>
        <button className="subpick__close" onClick={() => useSubtitleStore.getState().openSync(false)} aria-label="Close">×</button>
      </div>
      <div className={`subsync__hint${synced ? ' subsync__hint--ok' : ''}`}>{hint}</div>
      <div className="subsync__list" ref={listRef}>
        {cues.length === 0 && <div className="subpick__note">No spoken lines around here</div>}
        {cues.map((c) => {
          const key = syncCueKey(c);
          return (
            <button
              key={key}
              data-key={key}
              tabIndex={key === focus ? 0 : -1}
              className={`subsync__row${key === focus ? ' subsync__row--focus' : ''}`}
              onMouseEnter={() => { moved.current = true; setFocus(key); }}
              onFocus={() => setFocus(key)}
              onClick={() => pick(c)}
            >
              {c.text}
            </button>
          );
        })}
      </div>
      <div className="subsync__foot">
        <button className="subsync__done" onClick={() => useSubtitleStore.getState().openSync(false)}>Close</button>
      </div>
    </div>
  );
}
