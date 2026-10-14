// The stream main is playing, as one object. No electron imports, so it runs
// under node:test; main.ts drives it from the load, stop and reset paths.

import { StallWatchdog, LoadStatusGate } from './stream-health.js';

export interface MediaLoad {
  url: string;
  /** Whole seconds the load resumed at, 0 from the start */
  startPosition: number;
  live: boolean;
}

/** What playing is carried over a restart into the compatibility player */
export interface CompatibilityHandoff {
  url: string;
  position: number;
  live: boolean;
}

/** A handoff read back from disk; null when it is not one. */
export function parseCompatibilityHandoff(value: unknown): CompatibilityHandoff | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.url !== 'string' || typeof candidate.position !== 'number') return null;
  return { url: candidate.url, position: Math.max(0, candidate.position), live: candidate.live === true };
}

export interface StreamLoadRequest {
  url: string;
  startPosition?: number;
  live: boolean;
  /** play: asked for by the renderer; reload: the stall watchdog reloading the stream
      playing (keeps its watchdog and reload budget); restore: the compatibility restart */
  reason: 'play' | 'reload' | 'restore';
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
  /** The last mpv error held back during a reload, for the log when the watchdog gives up */
  lastHeldError: string | null = null;
  /** Holds the previous file's position/duration back until mpv unloads it */
  readonly gate = new LoadStatusGate();
  private pendingResume: number | null = null;

  /**
   * A load starts. player: the numbers mpv reports right now (before the gate);
   * only if it has some is there a previous file to wait out. A previous load
   * that never opened leaves none, and an idle mpv never reports an unload.
   */
  begin({ url, startPosition, live, reason }: StreamLoadRequest, now: number, player: { position: number; duration: number }): { generation: number; resumeAt: number } {
    const resumeAt = startPosition && startPosition > 0 ? Math.floor(startPosition) : 0;
    this.gate.begin(now, player.position > 0 || player.duration > 0);
    this.media = { url, startPosition: resumeAt, live };
    this.userPaused = false;
    if (reason !== 'reload' || !this.watchdog) {
      this.watchdog = new StallWatchdog({ live });
      this.lastHeldError = null;
    }
    this.generation++;
    this.pendingResume = resumeAt > 0 ? resumeAt : null;
    return { generation: this.generation, resumeAt };
  }

  /** Playback stopped or the player is going away. invalidate: drop anything still in flight for the old load. */
  end({ invalidate = false }: { invalidate?: boolean } = {}): void {
    this.media = null;
    this.watchdog = null;
    this.pendingResume = null;
    this.lastHeldError = null;
    if (invalidate) this.generation++;
  }

  /** The watchdog's reload of what is playing: a movie at its position, or where it was resuming if it never got there. */
  reloadRequest(position: number): StreamLoadRequest | null {
    const media = this.media;
    if (!media) return null;
    return {
      url: media.url,
      startPosition: media.live ? undefined : Math.max(position, media.startPosition),
      live: media.live,
      reason: 'reload',
    };
  }

  /** What to carry into the compatibility player: where playback is, or where it was resuming. */
  handoff(position: number): CompatibilityHandoff | null {
    const media = this.media;
    if (!media) return null;
    return { url: media.url, position: position > 0 ? position : media.startPosition, live: media.live };
  }

  /**
   * mpv's own error lines are expected while a stall reload opens the stream
   * again (the toast says what is happening and the watchdog has the final
   * word): held from the reload until playback moves, never while paused.
   */
  holdsMpvErrors(playing: boolean): boolean {
    return this.reloadInFlight || (playing && this.watchdog?.recovering === true);
  }

  /** The load failed before it ever played: stop watching it (no reloads of a link that does not open). */
  stopWatchingIfNeverPlayed(): void {
    if (this.watchdog && !this.watchdog.hasPlayed && this.watchdog.reloads === 0) this.watchdog = null;
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
