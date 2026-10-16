import { useEffect, useRef, useState } from 'react';
import type { RewindStateUpdate } from '../types/electron';
import { clampToReach, liveTarget, rewindBar, showNav, wallAt, type ClockAnchor } from '../utils/rewindModel';

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** Live progress with rewind: show span, dotted before the buffer, tint to live, tick, edge, playhead. */
export function LiveRewindBar({ state, anchor, position, program, onSeek, bump, lagS = 0 }: {
  state: RewindStateUpdate;
  anchor: ClockAnchor;
  position: number;
  program: { startMs: number; endMs: number } | null;
  onSeek?: (streamSeconds: number) => void;
  /** Changes when a seek key hit the oldest point: a short nudge of the playhead, no message */
  bump?: number;
  /** mpv's cushion behind the newest data: "live" is this far before the edge */
  lagS?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  /** Where the playhead is being dragged to (percent of the bar); null when not dragging */
  const [dragPct, setDragPct] = useState<number | null>(null);
  // The same, for handlers that may run before the next render (fast trackpad drags).
  const dragRef = useRef<number | null>(null);
  const setDrag = (pct: number | null) => { dragRef.current = pct; setDragPct(pct); };
  const [bumping, setBumping] = useState(false);
  useEffect(() => {
    if (!bump) return;
    setBumping(true);
    const t = setTimeout(() => setBumping(false), 300);
    return () => clearTimeout(t);
  }, [bump]);

  const bar = rewindBar({ state, anchor, position, program, lagS });
  const from = bar.spansBuffer || !program ? wallAt(anchor, state.rangeStart) : program.startMs;
  const to = bar.spansBuffer || !program ? wallAt(anchor, liveTarget(state, lagS)) : program.endMs;
  const wallAtPct = (pct: number) => from + ((to - from) * pct) / 100;
  const streamAtPct = (pct: number) => anchor.streamT + (wallAtPct(pct) - anchor.wallMs) / 1000;
  const pctAt = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)) : 0;
  };
  const inReach = (pct: number) => pct >= bar.tintFrom && pct <= bar.tintTo;

  // Drag the playhead (or press anywhere on the reachable part): it follows the
  // pointer inside what can be played, and the seek happens once, on release.
  const nav = showNav({ state, anchor, lagS, program: bar.spansBuffer ? null : program });
  function endDrag() {
    const pct = dragRef.current;
    if (pct === null) return;
    setDrag(null);
    onSeek?.(streamAtPct(pct));
  }
  const headPct = dragPct ?? bar.headPct;
  const tooltipPct = dragPct ?? hoverPct;

  return (
    <div
      ref={ref}
      className={`npb-progress-bar npb-rewind${bumping ? ' npb-rewind--bump' : ''}${dragPct !== null ? ' npb-rewind--dragging' : ''}${hoverPct !== null && inReach(hoverPct) ? ' npb-rewind--over-reach' : ''}`}
      onPointerDown={(e) => {
        const pct = pctAt(e.clientX);
        const onHead = Math.abs(pct - bar.headPct) < 2;
        if (e.button !== 0 || (!inReach(pct) && !onHead)) return;
        // Otherwise the browser turns press-and-drag into its own drag or text selection and cancels the pointer.
        e.preventDefault();
        // Keep tracking outside the bar; a pointer the browser no longer tracks just drags without capture.
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        setDrag(clampToReach(pct, bar));
      }}
      onPointerMove={(e) => {
        const pct = pctAt(e.clientX);
        setHoverPct(pct);
        if (dragRef.current !== null) setDrag(clampToReach(pct, bar));
      }}
      onPointerUp={(e) => {
        if (dragRef.current === null) return;
        dragRef.current = clampToReach(pctAt(e.clientX), bar);
        endDrag();
      }}
      // However a drag ends (macOS can cancel a trackpad drag, or capture can be lost), the video goes where the dot is.
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onMouseLeave={() => setHoverPct(null)}
    >
      {/* Earlier / later show: the bar shows one show at a time; these move to the next one in the buffer */}
      {nav.earlier !== null && (
        <button
          className="npb-rewind__nav npb-rewind__nav--earlier"
          aria-label="Earlier show" title="Earlier show"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onSeek?.(nav.earlier!); }}
        >‹</button>
      )}
      {nav.later !== null && (
        <button
          className="npb-rewind__nav npb-rewind__nav--later"
          aria-label="Later show" title="Later show"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onSeek?.(nav.later!); }}
        >›</button>
      )}
      <div className="npb-rewind__gone" style={{ width: `${bar.gonePct}%` }} />
      <div className="npb-rewind__tint" style={{ left: `${bar.tintFrom}%`, width: `${Math.max(0, bar.tintTo - bar.tintFrom)}%` }} />
      <div className="npb-rewind__fill" style={{ left: `${bar.tintFrom}%`, width: `${Math.max(0, headPct - bar.tintFrom)}%` }} />
      <div className="npb-rewind__tick" style={{ left: `${bar.tickPct}%` }} />
      <div className="npb-rewind__edge" style={{ left: `${bar.edgePct}%` }} />
      <div className="npb-scrubber-handle npb-rewind__head" style={{ left: `${headPct}%` }} />
      {tooltipPct !== null && (
        <>
          {/* Ends where the rewindable part starts (left of it, clear of the cursor); without room it starts at the bar's edge */}
          <div className="npb-rewind__cap" style={{ width: `${bar.tickPct}%` }}>
            <span>from {timeFmt.format(wallAt(anchor, state.rangeStart))}</span>
          </div>
          {/* Times only where you can go; the dotted and not-yet-aired parts explain themselves */}
          {inReach(tooltipPct) && (
            <div className="npb-time-tooltip" style={{ left: `${tooltipPct}%` }}>{timeFmt.format(wallAtPct(tooltipPct))}</div>
          )}
        </>
      )}
    </div>
  );
}
