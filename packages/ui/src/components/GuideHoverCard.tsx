import { useLayoutEffect, useRef, useState } from 'react';
import type { StoredProgram } from '../db';
import { clockRange, dayLabel, length, startsIn, timeLeft } from '../utils/airTime';
import './GuideHoverCard.css';

const ms = (d: Date | string) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const GAP = 6;
const EDGE = 8;
const DAY_NAMED_AFTER_MS = 6 * 3_600_000;

/**
 * A show's details beside its block: the title, one line of when (times, length, and how long is left or until it
 * starts), and the description. A show on now carries its progress along the card's top edge, as the channel cell's
 * line does. No channel line: the card sits on that channel's row. Placed under the block, or above when there's no room.
 */
export function GuideHoverCard({ program, anchor, now }: {
  program: StoredProgram;
  anchor: DOMRect;
  now: Date;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const { width, height } = card.getBoundingClientRect();
    const left = Math.min(Math.max(anchor.left, EDGE), window.innerWidth - width - EDGE);
    const below = anchor.bottom + GAP;
    const top = below + height <= window.innerHeight - EDGE ? below : Math.max(EDGE, anchor.top - GAP - height);
    setPos({ left, top });
  }, [anchor, program.id]);

  const start = ms(program.start);
  const end = ms(program.end);
  const t = now.getTime();
  const onNow = start <= t && t < end;
  const ended = end <= t;
  // The day only when it helps: not for a show starting within a few hours ("in 26m" already says when), even past midnight
  const day = Math.abs(start - t) < DAY_NAMED_AFTER_MS ? 'Today' : dayLabel(start, t);
  const status = onNow ? timeLeft(end, t) : ended ? 'Ended' : startsIn(start, t);

  return (
    <div
      ref={ref}
      className={`ghc${pos ? ' ghc--shown' : ''}${onNow ? ' ghc--now' : ''}`}
      role="tooltip"
      style={{
        ...(pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }),
        ...(onNow ? { ['--progress' as string]: `${((t - start) / (end - start)) * 100}%` } : {}),
      }}
    >
      <div className="ghc__title">{program.title}</div>
      <div className="ghc__when">
        <span className="ghc__times">{day !== 'Today' && `${day} `}{clockRange(start, end)}</span>
        <span className="ghc__len">{length(start, end)}</span>
        <span className="ghc__status">{status}</span>
      </div>
      {program.description && <p className="ghc__desc">{program.description}</p>}
    </div>
  );
}
