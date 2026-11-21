import { useLayoutEffect, useRef, useState } from 'react';
import type { StoredProgram } from '../db';
import { clockRange, dayLabel, daysFrom, durationLabel, startsIn, timeLeft } from '../utils/airTime';
import { onNow } from '../utils/onNow';
import './GuideHoverCard.css';

const GAP = 6;
const EDGE = 8;
/** The title bar: the card never tucks under it */
const TOP = 32 + EDGE;
/** Where the card's left edge sits relative to the pointer */
const POINTER_INSET = 24;
/** Within this of now, a show's day isn't named ("in 26m" already says when), even across midnight */
const DAY_NAMED_AFTER_MS = 6 * 3_600_000;

/**
 * A show's details, opened at the pointer under the block (or the channel cell's on-now line) that asked, or above
 * it when there's no room, kept inside the window: the title, one line of when (times, length, and time left or until
 * it starts), and the description. A show on now carries its progress along the top edge, as the channel cell's
 * line does. The channel isn't repeated: the card opens against its row.
 */
export function GuideHoverCard({ program, anchor, pointerX, now }: {
  program: StoredProgram;
  anchor: DOMRect;
  pointerX: number;
  now: Date;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const { width, height } = card.getBoundingClientRect();
    const left = Math.min(Math.max(pointerX - POINTER_INSET, EDGE), window.innerWidth - width - EDGE);
    const below = anchor.bottom + GAP;
    const top = below + height <= window.innerHeight - EDGE ? below : Math.max(TOP, anchor.top - GAP - height);
    setPos({ left, top });
  }, [anchor, pointerX, program.id]);

  const start = program.start.getTime();
  const end = program.end.getTime();
  const t = now.getTime();
  const live = onNow(program, now);
  const ended = end <= t;
  const day = Math.abs(start - t) >= DAY_NAMED_AFTER_MS && daysFrom(start, t) !== 0 ? dayLabel(start, t) : null;
  const status = live ? timeLeft(end, t) : ended ? 'Ended' : startsIn(start, t);

  return (
    <div
      ref={ref}
      className={`ghc${pos ? ' ghc--shown' : ''}${live ? ' ghc--now' : ''}`}
      role="tooltip"
      style={{
        ...(pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }),
        ...(live ? { '--progress': `${live.pct}%` } : {}),
      }}
    >
      {program.title && <div className="ghc__title" dir="auto">{program.title}</div>}
      <div className="ghc__when">
        <span className="ghc__times">{day && `${day} `}{clockRange(start, end)}</span>
        <span className="ghc__len">{durationLabel(start, end)}</span>
        <span className="ghc__status">{status}</span>
      </div>
      {program.description && <p className="ghc__desc" dir="auto">{program.description}</p>}
    </div>
  );
}
