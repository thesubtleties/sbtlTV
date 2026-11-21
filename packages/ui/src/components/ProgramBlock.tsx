import { useContext, useMemo, memo } from 'react';
import { GuideHighlight } from './GuideSearchResults';
import { GuideHover } from './guideHover';
import { clockRange } from '../utils/airTime';
import type { StoredProgram } from '../db';
import './ProgramBlock.css';

interface ProgramBlockProps {
  program: StoredProgram;
  windowStart: Date;
  windowEnd: Date;
  /** What is on now (the guide's minute tick), so the highlight moves when a show ends */
  now: Date;
  pixelsPerHour: number;
  onClick?: () => void;
  className?: string;
  // Delay for an entrance animation carried by className (see ProgramLane)
  enterDelayMs?: number;
}

interface ProgramStyle {
  left: number;
  width: number;
  visible: boolean;
}

// Gap between program blocks in pixels
const PROGRAM_GAP = 2;

export function getProgramStyle(
  program: StoredProgram,
  windowStart: Date,
  windowEnd: Date,
  pixelsPerHour: number
): ProgramStyle {
  const windowStartMs = windowStart.getTime();
  const windowEndMs = windowEnd.getTime();

  const progStartMs = program.start instanceof Date ? program.start.getTime() : new Date(program.start).getTime();
  const progEndMs = program.end instanceof Date ? program.end.getTime() : new Date(program.end).getTime();

  // Not visible if entirely outside window
  if (progEndMs <= windowStartMs || progStartMs >= windowEndMs) {
    return { left: 0, width: 0, visible: false };
  }

  // Clamp to visible window
  const visibleStart = Math.max(progStartMs, windowStartMs);
  const visibleEnd = Math.min(progEndMs, windowEndMs);

  // Calculate position and width in pixels
  const startOffsetHours = (visibleStart - windowStartMs) / 3600000;
  const durationHours = (visibleEnd - visibleStart) / 3600000;

  // Subtract gap from width to create visual separation
  const rawWidth = durationHours * pixelsPerHour;
  const width = Math.max(rawWidth - PROGRAM_GAP, 20); // Minimum 20px to stay readable

  return {
    left: startOffsetHours * pixelsPerHour,
    width,
    visible: true,
  };
}

/** How much of a show on now has aired, in px from its block's left edge (0 to the block's width). */
export function airedPx(left: number, width: number, now: Date, windowStart: Date, pixelsPerHour: number): number {
  const nowX = ((now.getTime() - windowStart.getTime()) / 3_600_000) * pixelsPerHour;
  return Math.min(width, Math.max(0, nowX - left));
}

/** Narrower than this, a show on now cut off at the grid's left edge drops its text (see isSliver). */
const SLIVER_PX = 56;

/**
 * A show on now cut off at the grid's left edge with little of it left in view: a tinted sliver, not clipped
 * letters. Its text is hidden only while the channel cell names the show on now (.guide-now-on, see the CSS); a short
 * show that starts in view keeps its text.
 */
export function isSliver(program: StoredProgram, width: number, now: Date, windowStart: Date): boolean {
  return width < SLIVER_PX && program.start.getTime() < windowStart.getTime() && isProgramCurrent(program, now);
}

/** A show that already ended (by the guide's tick): drawn as an outline, see the CSS. Shown at the grid's :00/:30
 * start and whenever the guide looks back. */
export function isProgramEnded(program: StoredProgram, now: Date): boolean {
  const progEndMs = program.end instanceof Date ? program.end.getTime() : new Date(program.end).getTime();
  return progEndMs <= now.getTime();
}

export function isProgramCurrent(program: StoredProgram, now: Date): boolean {
  const progStartMs = program.start instanceof Date ? program.start.getTime() : new Date(program.start).getTime();
  const progEndMs = program.end instanceof Date ? program.end.getTime() : new Date(program.end).getTime();
  return progStartMs <= now.getTime() && progEndMs > now.getTime();
}

export const ProgramBlock = memo(function ProgramBlock({
  program,
  windowStart,
  windowEnd,
  now,
  pixelsPerHour,
  onClick,
  className,
  enterDelayMs,
}: ProgramBlockProps) {
  const style = useMemo(
    () => getProgramStyle(program, windowStart, windowEnd, pixelsPerHour),
    [program, windowStart, windowEnd, pixelsPerHour]
  );

  const highlight = useContext(GuideHighlight);
  const hover = useContext(GuideHover);
  const lit = highlight?.has(program.id) ?? false;

  // Check if this program contains "now"
  const isCurrent = isProgramCurrent(program, now);
  const ended = isProgramEnded(program, now);

  if (!style.visible) {
    return null;
  }

  // How much of the show on now has aired (drawn brighter, see the CSS)
  const aired = isCurrent ? airedPx(style.left, style.width, now, windowStart, pixelsPerHour) : 0;
  const sliver = isSliver(program, style.width, now, windowStart);

  // Determine if we should show description (only if block is wide enough)
  const showDescription = style.width > 200 && program.description;

  return (
    <div
      className={`program-block ${isCurrent ? 'current' : ''}${ended ? ' program-block--ended' : ''}${sliver ? ' program-block--sliver' : ''}${className ? ` ${className}` : ''}${lit ? ' program-block--found' : ''}`}
      style={{
        left: `${style.left}px`,
        width: `${style.width}px`,
        ...(enterDelayMs !== undefined ? { animationDelay: `${enterDelayMs}ms` } : {}),
        ...(isCurrent ? { '--aired': `${aired}px` } : {}),
      }}
      onClick={onClick}
      // Whether it ended or is on now, the times and description for screen readers (the hover card is for the
      // pointer; same words as the card and the channel cell)
      aria-description={`${ended ? 'Ended, ' : isCurrent ? 'On now, ' : ''}${clockRange(program.start.getTime(), program.end.getTime())}${program.description ? `. ${program.description}` : ''}`}
      onMouseEnter={(e) => hover?.show(program, e.currentTarget, e.clientX)}
      onMouseLeave={() => hover?.hide()}
    >
      <span className="program-block-title" dir="auto">{program.title}</span>
      {showDescription && (
        <span className="program-block-desc" dir="auto">{program.description}</span>
      )}
    </div>
  );
});

// Empty state for channels with no EPG data
export const EmptyProgramBlock = memo(function EmptyProgramBlock({ pixelsPerHour, visibleHours }: { pixelsPerHour: number; visibleHours: number }) {
  const width = pixelsPerHour * visibleHours;

  return (
    <div
      className="program-block empty"
      style={{
        left: 0,
        width: `${width}px`,
      }}
    >
      <span className="program-block-title">No EPG Data</span>
    </div>
  );
});
