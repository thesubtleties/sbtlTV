// The stream main is playing, as one object. No electron imports, so it runs
// under node:test; main.ts drives it from the load, stop and reset paths.

import { StallWatchdog, LoadStatusGate } from './stream-health.js';

export interface MediaLoad {
  url: string;
  /** Whole seconds the load resumed at, 0 from the start */
  startPosition: number;
  live: boolean;
}

export interface StreamLoadRequest {
  url: string;
  startPosition?: number;
  live: boolean;
  /** A watchdog reload of the stream already playing: keeps its watchdog (and reload budget) */
  recovery?: boolean;
}

/**
 * What is loaded (for reloads and the compatibility handoff), its load
 * generation, the resume seek still to do, the user's own pause, its stall
 * watchdog and the gate holding back the previous file's numbers. Every path
 * that starts or ends playback goes through begin()/end(), so nothing of one
 * stream is left over for the next.
 */
export class StreamSession {
  /** Bumped by every load (and by end with invalidate); tags everything sent for a load */
  generation = 0;
  media: MediaLoad | null = null;
  watchdog: StallWatchdog | null = null;
  /** The user's own pause, so mpv pausing at the end of a stream is not mistaken for it */
  userPaused = false;
  reloadInFlight = false;
  /** Holds the previous file's position/duration back until mpv unloads it */
  readonly gate = new LoadStatusGate();
  private pendingResume: number | null = null;

  /** A load starts. hadPrevious: mpv had a file loaded or playing before it. */
  begin({ url, startPosition, live, recovery = false }: StreamLoadRequest, now: number, hadPrevious: boolean): { generation: number; resumeAt: number } {
    const resumeAt = startPosition && startPosition > 0 ? Math.floor(startPosition) : 0;
    this.gate.begin(now, hadPrevious);
    this.media = { url, startPosition: resumeAt, live };
    this.userPaused = false;
    if (!recovery || !this.watchdog) this.watchdog = new StallWatchdog({ live });
    this.generation++;
    this.pendingResume = resumeAt > 0 ? resumeAt : null;
    return { generation: this.generation, resumeAt };
  }

  /** Playback stopped or the player is going away. invalidate: drop anything still in flight for the old load. */
  end({ invalidate = false }: { invalidate?: boolean } = {}): void {
    this.media = null;
    this.watchdog = null;
    this.pendingResume = null;
    if (invalidate) this.generation++;
  }

  isCurrent(generation: unknown): boolean {
    return generation === this.generation;
  }

  /** The file is open (its duration is known): the position to resume at, handed out once. */
  takeResume(duration: number): number | null {
    if (this.pendingResume === null || !(duration > 0)) return null;
    const position = this.pendingResume;
    this.pendingResume = null;
    return position;
  }
}
