import { useEffect, useMemo, useRef, useState, memo, type CSSProperties } from 'react';
import type { StoredProgram } from '../db';
import { useGuideMorphEnabled } from '../stores/uiStore';
import { ProgramBlock, EmptyProgramBlock, getProgramStyle, isProgramCurrent } from './ProgramBlock';
import {
  loadingBlocks,
  planMorph,
  decideLane,
  MORPH_LEAD_MS,
  MORPH_TOTAL_MS,
  type LoadingBlock,
  type MorphPlan,
} from './programLaneModel';

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

interface VisibleProgram {
  key: string;
  left: number;
  width: number;
  onAir: boolean;
  ended: boolean;
  program: StoredProgram;
}

type Phase =
  | { kind: 'loading'; since: number }
  // The plan is fixed when the morph starts so blocks never swap programs
  // mid-flight; laneKey records the window it was planned for.
  | { kind: 'morph'; moving: boolean; plan: MorphPlan<VisibleProgram>; placeholders: LoadingBlock[]; laneKey: string }
  | { kind: 'ready'; entering: boolean };

function programEndMs(program: StoredProgram): number {
  return program.end instanceof Date ? program.end.getTime() : new Date(program.end).getTime();
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function placeholderStyle(block: LoadingBlock): CSSProperties {
  return { left: `${block.left}px`, width: `${Math.max(block.width - 2, 20)}px` };
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
  // Read through a ref so flipping the setting does not restart the effect;
  // it applies to the next row that resolves.
  const morphEnabled = useGuideMorphEnabled();
  const morphEnabledRef = useRef(morphEnabled);
  morphEnabledRef.current = morphEnabled;

  const laneWidth = pixelsPerHour * visibleHours;
  const placeholders = useMemo(() => loadingBlocks(rowIndex, laneWidth), [rowIndex, laneWidth]);
  const laneKey = `${windowStart.getTime()}:${windowEnd.getTime()}:${pixelsPerHour}`;

  // Programs arrays are rebuilt by every live query re-run; only a change in
  // which programs are present should move the lane between phases.
  const programKey = programs === undefined ? undefined : programs.map((p) => p.id).join(',');
  const hadProgramsRef = useRef(programs !== undefined && programs.length > 0);

  useEffect(() => {
    const current = phaseRef.current;
    const hadPrograms = hadProgramsRef.current;
    hadProgramsRef.current = programs !== undefined && programs.length > 0;

    const decision = decideLane({
      phase: current.kind,
      loadingSinceMs: current.kind === 'loading' ? current.since : 0,
      hadPrograms,
      programs: programs === undefined ? 'unread' : programs.length === 0 ? 'empty' : 'some',
      nowMs: Date.now(),
      reducedMotion: reducedMotion(),
      morphEnabled: morphEnabledRef.current,
    });

    if (decision === 'stay') return;
    if (decision === 'load') {
      setPhase({ kind: 'loading', since: Date.now() });
      return;
    }
    if (decision === 'ready' || decision === 'fade-in') {
      setPhase({ kind: 'ready', entering: decision === 'fade-in' });
      return;
    }

    // morph: plan once, against the window as it is right now.
    const now = new Date();
    const visible: VisibleProgram[] = (programs ?? [])
      .map((program) => ({ program, style: getProgramStyle(program, windowStart, windowEnd, pixelsPerHour) }))
      .filter((entry) => entry.style.visible)
      .map((entry) => ({
        key: entry.program.id,
        left: entry.style.left,
        width: entry.style.width,
        onAir: isProgramCurrent(entry.program, now),
        ended: programEndMs(entry.program) <= now.getTime(),
        program: entry.program,
      }));
    const plan = planMorph(placeholders, visible);
    if (plan.become.length === 0) {
      // Nothing on screen to carry; behave like a quick resolve.
      setPhase({ kind: 'ready', entering: visible.length > 0 });
      return;
    }
    setPhase({ kind: 'morph', moving: false, plan, placeholders, laneKey });
    const lead = setTimeout(() => {
      if (phaseRef.current.kind === 'morph') setPhase({ ...phaseRef.current, moving: true });
    }, MORPH_LEAD_MS);
    const done = setTimeout(() => {
      if (phaseRef.current.kind === 'morph') setPhase({ kind: 'ready', entering: false });
    }, MORPH_TOTAL_MS);
    return () => {
      clearTimeout(lead);
      clearTimeout(done);
    };
    // programKey stands in for programs (see above); the window values are
    // read once when a morph is planned and guarded by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programKey]);

  // A morph planned for one window cannot finish in another: if the guide
  // pages or rescales mid-morph, land with a fade instead.
  useEffect(() => {
    const current = phaseRef.current;
    if (current.kind === 'morph' && current.laneKey !== laneKey) {
      setPhase({ kind: 'ready', entering: true });
    }
  }, [laneKey]);

  if (phase.kind === 'loading') {
    return (
      <>
        {placeholders.map((block, i) => (
          <div
            key={i}
            className="program-block loading"
            aria-hidden="true"
            style={{
              ...placeholderStyle(block),
              '--dur': `${block.durationMs}ms`,
              '--phase': `${block.phaseMs}ms`,
            } as CSSProperties}
          />
        ))}
      </>
    );
  }

  if (phase.kind === 'morph') {
    const { plan, moving } = phase;
    return (
      <>
        {plan.become.map(({ placeholder, program, titled }) => (
          <div
            key={`m${placeholder}`}
            className={`program-block morph become${moving && program.onAir ? ' current' : ''}`}
            style={moving ? { left: `${program.left}px`, width: `${program.width}px` } : placeholderStyle(phase.placeholders[placeholder])}
          >
            {(titled || moving) && (
              <span className={`program-block-title${titled ? '' : ' late'}`}>{program.program.title}</span>
            )}
          </div>
        ))}
        {plan.spare.map((placeholder) => (
          <div
            key={`s${placeholder}`}
            className={`program-block morph${moving ? ' spare' : ''}`}
            aria-hidden="true"
            style={placeholderStyle(phase.placeholders[placeholder])}
          />
        ))}
        {moving &&
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
