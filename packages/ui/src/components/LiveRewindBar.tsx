import { useEffect, useRef, useState } from 'react';
import type { RewindStateUpdate } from '../types/electron';
import { liveTarget, rewindBar, wallAt, type ClockAnchor } from '../utils/rewindModel';

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
  const outOfReach = (pct: number) => (pct < bar.tintFrom ? (state.rangeStart > 0 ? 'Earlier than rewind keeps' : 'Before you tuned in') : 'Not aired yet');

  return (
    <div
      ref={ref}
      className={`npb-progress-bar npb-rewind${bumping ? ' npb-rewind--bump' : ''}`}
      onMouseMove={(e) => setHoverPct(pctAt(e.clientX))}
      onMouseLeave={() => setHoverPct(null)}
      onClick={(e) => { const pct = pctAt(e.clientX); if (inReach(pct)) onSeek?.(streamAtPct(pct)); }}
    >
      {bar.reachesEarlierShow && <span className="npb-rewind__earlier">‹</span>}
      <div className="npb-rewind__gone" style={{ width: `${bar.gonePct}%` }} />
      <div className="npb-rewind__tint" style={{ left: `${bar.tintFrom}%`, width: `${Math.max(0, bar.tintTo - bar.tintFrom)}%` }} />
      <div className="npb-rewind__fill" style={{ left: `${bar.tintFrom}%`, width: `${Math.max(0, bar.fillTo - bar.tintFrom)}%` }} />
      <div className="npb-rewind__tick" style={{ left: `${bar.tickPct}%` }} />
      <div className="npb-rewind__edge" style={{ left: `${bar.edgePct}%` }} />
      <div className="npb-scrubber-handle npb-rewind__head" style={{ left: `${bar.headPct}%` }} />
      {hoverPct !== null && (
        <>
          {/* Centred under the tick, but kept inside the bar near either end */}
          <div className="npb-rewind__cap" style={{ left: `${bar.tickPct}%`, transform: bar.tickPct < 10 ? 'none' : bar.tickPct > 90 ? 'translateX(-100%)' : undefined }}>
            from {timeFmt.format(wallAt(anchor, state.rangeStart))}
          </div>
          <div className="npb-time-tooltip" style={{ left: `${hoverPct}%` }}>
            {inReach(hoverPct) ? timeFmt.format(wallAtPct(hoverPct)) : outOfReach(hoverPct)}
          </div>
        </>
      )}
    </div>
  );
}
