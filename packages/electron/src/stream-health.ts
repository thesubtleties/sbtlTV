// Keeping a stream playing when the provider cuts or stalls it. Pure parts
// (no electron imports, testable under node:test); main.ts drives them.

/**
 * ffmpeg's HTTP reconnect, for both players (mpv `stream-lavf-o`). A provider
 * that closes a live stream mid-way ("Stream ends prematurely") is reopened at
 * once; movies already recovered by re-requesting from their byte offset, this
 * also covers network errors. Without reconnect_at_eof: on a movie that would
 * loop at the real ending; a live stream that ends cleanly is the watchdog's.
 * Proven against a local server that cuts a live stream (2026-10-12).
 */
export const STREAM_RECONNECT_OPTIONS = 'reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=4';

/**
 * Stream options for both players. ytdl=no: mpv's youtube-dl hook retries every
 * URL that fails to open through youtube-dl, which IPTV never needs and which
 * floods the banner ("ytdl_hook: youtube-dl failed") on a dead stream.
 */
export const STREAM_BASE_OPTIONS: Array<[string, string]> = [
  ['stream-lavf-o', STREAM_RECONNECT_OPTIONS],
  ['ytdl', 'no'],
];

export interface StallSample {
  now: number;
  /** Playback position in seconds */
  position: number;
  /** The user paused (not mpv pausing itself at the end of a stream) */
  userPaused: boolean;
  /** File duration in seconds, 0 for live */
  duration: number;
}

/**
 * Notices a stream that stopped moving without the user pausing it (a dead
 * connection, a live stream that ended, a reconnect that keeps failing) and
 * asks for a reload, up to maxReloads times; then gives up once. A reload
 * that brings playback back for recoveredAfterMs restores the budget.
 */
export class StallWatchdog {
  reloads = 0;
  private lastPosition: number | null = null;
  private lastMoveAt = 0;
  private movingSince: number | null = null;
  private givenUp = false;
  private readonly live: boolean;
  private readonly stallMs: number;
  private readonly maxReloads: number;
  private readonly recoveredAfterMs: number;

  constructor(opts: { live: boolean; stallMs?: number; maxReloads?: number; recoveredAfterMs?: number }) {
    this.live = opts.live;
    this.stallMs = opts.stallMs ?? 15_000;
    this.maxReloads = opts.maxReloads ?? 3;
    this.recoveredAfterMs = opts.recoveredAfterMs ?? 30_000;
  }

  /** Between a reload and playback moving again: mpv's own errors are expected then and stay out of the banner. */
  get recovering(): boolean {
    return this.reloads > 0 && this.movingSince === null && !this.givenUp;
  }

  observe({ now, position, userPaused, duration }: StallSample): 'none' | 'reload' | 'give-up' {
    if (this.lastPosition === null) {
      this.lastPosition = position;
      this.lastMoveAt = now;
      return 'none';
    }
    if (this.givenUp) return 'none';
    const atEnd = !this.live && duration > 0 && position >= duration - 2;
    if (userPaused || atEnd) {
      this.lastPosition = position;
      this.lastMoveAt = now;
      this.movingSince = null;
      return 'none';
    }
    if (Math.abs(position - this.lastPosition) > 0.5) {
      this.lastPosition = position;
      this.lastMoveAt = now;
      this.movingSince ??= now;
      if (this.reloads > 0 && now - this.movingSince >= this.recoveredAfterMs) this.reloads = 0;
      return 'none';
    }
    this.movingSince = null;
    if (now - this.lastMoveAt < this.stallMs) return 'none';
    if (this.reloads < this.maxReloads) {
      this.reloads++;
      this.lastMoveAt = now;  // give the reload its own 15s
      return 'reload';
    }
    this.givenUp = true;
    return 'give-up';
  }
}

/**
 * After a loadfile, mpv keeps reporting the previous file's position and
 * duration until it unloads it (half a second in a 2026-10-12 trace: CNN's
 * 20s / 35s arrived after Obsession was chosen, and were saved as Obsession's
 * progress). Hold both at 0 until the unload shows (both unavailable, which
 * reads as 0), or for at most UNLOAD_WAIT_MS if it never does.
 */
const UNLOAD_WAIT_MS = 3000;

export class LoadStatusGate {
  private waitingSince: number | null = null;

  /** A load started; hadPrevious: a file was loaded or playing before it. */
  begin(now: number, hadPrevious: boolean): void {
    this.waitingSince = hadPrevious ? now : null;
  }

  pass(status: { position: number; duration: number }, now: number): { position: number; duration: number } {
    if (this.waitingSince !== null) {
      const unloaded = status.position === 0 && status.duration === 0;
      if (unloaded || now - this.waitingSince > UNLOAD_WAIT_MS) this.waitingSince = null;
      else return { position: 0, duration: 0 };
    }
    return { position: status.position, duration: status.duration };
  }
}
