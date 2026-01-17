import { useMemo } from 'react';
import type { StoredProgram } from '../db';
import './ProgramBlock.css';

interface ProgramBlockProps {
  program: StoredProgram;
  windowStart: Date;
  windowEnd: Date;
  pixelsPerHour: number;
  onClick?: () => void;
}

interface ProgramStyle {
  left: number;
  width: number;
  visible: boolean;
}

// Gap between program blocks in pixels
const PROGRAM_GAP = 2;

function getProgramStyle(
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

export function ProgramBlock({
  program,
  windowStart,
  windowEnd,
  pixelsPerHour,
  onClick,
}: ProgramBlockProps) {
  const style = useMemo(
    () => getProgramStyle(program, windowStart, windowEnd, pixelsPerHour),
    [program, windowStart, windowEnd, pixelsPerHour]
  );

  // Check if this program contains "now"
  const now = new Date();
  const progStartMs = program.start instanceof Date ? program.start.getTime() : new Date(program.start).getTime();
  const progEndMs = program.end instanceof Date ? program.end.getTime() : new Date(program.end).getTime();
  const isCurrent = progStartMs <= now.getTime() && progEndMs > now.getTime();

  // Format time for tooltip
  const formatTime = (date: Date | string) => {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!style.visible) {
    return null;
  }

  // Determine if we should show description (only if block is wide enough)
  const showDescription = style.width > 200 && program.description;

  return (
    <div
      className={`program-block ${isCurrent ? 'current' : ''}`}
      style={{
        left: `${style.left}px`,
        width: `${style.width}px`,
      }}
      onClick={onClick}
      title={`${program.title}\n${formatTime(program.start)} - ${formatTime(program.end)}${program.description ? `\n\n${program.description}` : ''}`}
    >
      <span className="program-block-title">{program.title}</span>
      {showDescription && (
        <span className="program-block-desc">{program.description}</span>
      )}
    </div>
  );
}

// Empty state for channels with no EPG data
export function EmptyProgramBlock({ pixelsPerHour, visibleHours }: { pixelsPerHour: number; visibleHours: number }) {
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
}
