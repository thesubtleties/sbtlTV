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
  /** The user paused in the app */
  userPaused: boolean;
  /** File duration in seconds, 0 for live */
  duration: number;
  /** mpv's own pause is off (it may still be waiting for data) */
  playing: boolean;
  /**
   * mpv stopped at the end of what it could read (keep-open pauses it there).
   * A synchronous read into mpv, so asked only when mpv paused itself.
   */
  readEof: () => boolean;
}

/** Reloads before the watchdog gives up and says so */
export const STALL_MAX_RELOADS = 3;

/**
 * A movie that reaches the end of its file within this many seconds of its
 * duration has finished (files often end a little short of the duration their
 * container reports); further from the end it was cut, and is reloaded. Short
 * clips get 5% of their length instead.
 */
const VOD_END_SLACK_S = 120;
const VOD_END_SLACK_SHARE = 0.05;

/**
 * Notices a stream that stopped moving without anyone pausing it (a dead
 * connection, a live stream that ended, a reconnect that keeps failing) and
 * asks for a reload, up to maxReloads times; then gives up once. A reload
 * that brings playback back for recoveredAfterMs restores the budget.
 *
 * Moving means the position getting more than half a second past where it
 * last moved (so a stream crawling forward counts). A jump (the 0 that
 * LoadStatusGate holds after a reload, a seek) is not playback: it starts a
 * new wait with openGraceMs, as a load does (movies can take a while to open,
 * a seek a while to get its data).
 */
export class StallWatchdog {
  reloads = 0;
  private lastPosition: number | null = null;  // the previous sample, to tell jumps
  private lastSampleAt = 0;
  private anchor = 0;  // the position at the last movement (or jump)
  private lastMoveAt = 0;
  private movingSince: number | null = null;
  private started = false;  // moved since the load, the last reload or the last jump
  private everPlayed = false;
  private givenUp = false;
  private readonly live: boolean;
  private readonly stallMs: number;
  private readonly openGraceMs: number;
  private readonly maxReloads: number;
  private readonly recoveredAfterMs: number;

  constructor(opts: { live: boolean; stallMs?: number; openGraceMs?: number; maxReloads?: number; recoveredAfterMs?: number }) {
    this.live = opts.live;
    this.stallMs = opts.stallMs ?? 15_000;
    this.openGraceMs = opts.openGraceMs ?? (opts.live ? this.stallMs : 45_000);
    this.maxReloads = opts.maxReloads ?? STALL_MAX_RELOADS;
    this.recoveredAfterMs = opts.recoveredAfterMs ?? 30_000;
  }

  /** Between a reload and playback moving again: mpv's own errors are expected then and stay out of the banner. */
  get recovering(): boolean {
    return this.reloads > 0 && this.movingSince === null && !this.givenUp;
  }

  /** This load has played at some point (a seek or the held 0 does not count). */
  get hasPlayed(): boolean {
    return this.everPlayed;
  }

  observe({ now, position, userPaused, duration, playing, readEof }: StallSample): 'none' | 'reload' | 'give-up' {
    const elapsedS = (now - this.lastSampleAt) / 1000;
    const previous = this.lastPosition;
    this.lastPosition = position;
    this.lastSampleAt = now;
    if (previous === null) {
      this.anchor = position;
      this.lastMoveAt = now;
      return 'none';
    }
    if (this.givenUp) return 'none';
    const eof = !playing && !userPaused && readEof();
    const slack = Math.min(VOD_END_SLACK_S, duration * VOD_END_SLACK_SHARE);
    const ended = !this.live && duration > 0 && (position >= duration - 2 || (eof && position >= duration - slack));
    // Paused by the user, or by mpv for something other than the stream ending
    // (system suspend, the compatibility player's own window): wait for it.
    const pausedElsewhere = !playing && !eof;
    if (userPaused || pausedElsewhere || ended) {
      this.anchor = position;
      this.lastMoveAt = now;
      this.movingSince = null;
      return 'none';
    }
    if (position < previous - 0.5 || position > previous + elapsedS + 5) {
      // A jump, not playback: wait for the stream from here as for a new open.
      this.anchor = position;
      this.lastMoveAt = now;
      this.started = false;
      this.movingSince = null;
      return 'none';
    }
    if (position - this.anchor > 0.5) {
      this.anchor = position;
      this.lastMoveAt = now;
      this.started = true;
      this.everPlayed = true;
      this.movingSince ??= now;
      if (this.reloads > 0 && now - this.movingSince >= this.recoveredAfterMs) this.reloads = 0;
      return 'none';
    }
    this.movingSince = null;
    if (now - this.lastMoveAt < (this.started ? this.stallMs : this.openGraceMs)) return 'none';
    if (this.reloads < this.maxReloads) {
      this.reloads++;
      this.lastMoveAt = now;  // the reload gets its own time to open
      this.started = false;
      return 'reload';
    }
    this.givenUp = true;
    return 'give-up';
  }
}

/**
 * After a loadfile, mpv keeps reporting the previous file's position and
 * duration until it unloads it (about half a second). Hold both at 0 until the
 * unload shows (both unavailable, which reads as 0), or for at most
 * UNLOAD_WAIT_MS if it never does; otherwise the previous file's numbers pass
 * as the new one's (a live channel's position saved as a movie's progress).
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
