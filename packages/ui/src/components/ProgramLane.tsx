import { useEffect, useMemo, useRef, useState, memo } from 'react';
import type { StoredProgram } from '../db';
import { ProgramBlock, EmptyProgramBlock, getProgramStyle, isProgramCurrent } from './ProgramBlock';
import { loadingBlocks, planMorph, resolveKind, MORPH_LEAD_MS, MORPH_TOTAL_MS } from './programLane';

interface ProgramLaneProps {
  // undefined while the row's programs have not been read; [] when the channel has no EPG
  programs: StoredProgram[] | undefined;
  rowIndex: number;
  windowStart: Date;
  windowEnd: Date;
  pixelsPerHour: number;
  visibleHours: number;
  onPlay: () => void;
}

type Phase =
  | { kind: 'loading'; since: number }
  | { kind: 'morph'; programs: StoredProgram[]; moving: boolean }
  | { kind: 'ready'; entering: boolean };

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

// The program cells of one guide row. Before the programs are read the lane
// shows placeholder blocks whose edges wake on their own periods. When the
// programs arrive after a wait the user could notice, each placeholder takes
// a title, then carries it into the program's real position; when they arrive
// almost at once, the real blocks simply fade in.
export const ProgramLane = memo(function ProgramLane({
  programs,
  rowIndex,
  windowStart,
  windowEnd,
  pixelsPerHour,
  visibleHours,
  onPlay,
}: ProgramLaneProps) {
  const [phase, setPhase] = useState<Phase>(() =>
    programs === undefined ? { kind: 'loading', since: Date.now() } : { kind: 'ready', entering: false }
  );
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const laneWidth = pixelsPerHour * visibleHours;
  const placeholders = useMemo(() => loadingBlocks(rowIndex, laneWidth), [rowIndex, laneWidth]);

  // Programs arrays are rebuilt by every live query re-run; only a change in
  // which programs are present should move the lane between phases.
  const programKey = programs === undefined ? undefined : programs.map((p) => p.id).join(',');

  useEffect(() => {
    const current = phaseRef.current;
    if (programs === undefined) {
      if (current.kind !== 'loading') setPhase({ kind: 'loading', since: Date.now() });
      return;
    }
    if (current.kind === 'ready') return;
    if (current.kind === 'morph') {
      // The set of programs changed mid-morph; land on whatever is current.
      setPhase({ kind: 'ready', entering: false });
      return;
    }
    if (programs.length === 0 || reducedMotion() || resolveKind(current.since, Date.now()) === 'quick') {
      setPhase({ kind: 'ready', entering: programs.length > 0 && !reducedMotion() });
      return;
    }
    setPhase({ kind: 'morph', programs, moving: false });
    const lead = setTimeout(() => setPhase({ kind: 'morph', programs, moving: true }), MORPH_LEAD_MS);
    const done = setTimeout(() => setPhase({ kind: 'ready', entering: false }), MORPH_TOTAL_MS);
    return () => {
      clearTimeout(lead);
      clearTimeout(done);
    };
    // programKey stands in for programs: see the comment above it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programKey]);

  if (phase.kind === 'loading') {
    return (
      <>
        {placeholders.map((block, i) => (
          <div
            key={i}
            className="program-block loading"
            aria-hidden="true"
            style={{
              left: `${block.left}px`,
              width: `${Math.max(block.width - 2, 20)}px`,
              ['--dur' as string]: `${block.durationMs}ms`,
              ['--phase' as string]: `${block.phaseMs}ms`,
            }}
          />
        ))}
      </>
    );
  }

  if (phase.kind === 'morph') {
    const now = new Date();
    const visible = phase.programs
      .map((program) => ({ program, style: getProgramStyle(program, windowStart, windowEnd, pixelsPerHour) }))
      .filter((entry) => entry.style.visible)
      .map((entry) => ({ key: entry.program.id, left: entry.style.left, width: entry.style.width, program: entry.program }));
    const plan = planMorph(placeholders.length, visible);
    return (
      <>
        {plan.become.map(({ placeholder, program }) => {
          const from = placeholders[placeholder];
          const current = phase.moving && isProgramCurrent(program.program, now);
          return (
            <div
              key={`m${placeholder}`}
              className={`program-block morph become${current ? ' current' : ''}`}
              style={
                phase.moving
                  ? { left: `${program.left}px`, width: `${program.width}px` }
                  : { left: `${from.left}px`, width: `${Math.max(from.width - 2, 20)}px` }
              }
            >
              <span className="program-block-title">{program.program.title}</span>
            </div>
          );
        })}
        {plan.spare.map((placeholder) => {
          const from = placeholders[placeholder];
          return (
            <div
              key={`s${placeholder}`}
              className={`program-block morph${phase.moving ? ' spare' : ''}`}
              aria-hidden="true"
              style={{ left: `${from.left}px`, width: `${Math.max(from.width - 2, 20)}px` }}
            />
          );
        })}
        {phase.moving &&
          plan.extra.map((entry, i) => (
            <ProgramBlock
              key={entry.program.id}
              program={entry.program}
              windowStart={windowStart}
              windowEnd={windowEnd}
              pixelsPerHour={pixelsPerHour}
              onClick={onPlay}
              className="program-block-in"
              enterDelayMs={i * 40}
            />
          ))}
      </>
    );
  }

  if (programs === undefined || programs.length === 0) {
    return <EmptyProgramBlock pixelsPerHour={pixelsPerHour} visibleHours={visibleHours} />;
  }

  return (
    <>
      {programs.map((program, i) => (
        <ProgramBlock
          key={program.id}
          program={program}
          windowStart={windowStart}
          windowEnd={windowEnd}
          pixelsPerHour={pixelsPerHour}
          onClick={onPlay}
          className={phase.entering ? 'program-block-in' : undefined}
          enterDelayMs={phase.entering ? i * 40 : undefined}
        />
      ))}
    </>
  );
});
