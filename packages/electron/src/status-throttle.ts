/**
 * Rate-limits mpv status messages to the renderer without losing any.
 *
 * mpv reports the position at frame rate; forwarding every tick costs an IPC
 * message and a React commit each. A status whose discrete fields changed
 * (pause, mute, volume, duration, size) goes out at once; position-only
 * updates go out at most once per interval, and the latest one held back is
 * always sent when the interval ends. Without that trailing send, the last
 * tick before mpv goes quiet (a seek while paused, a pause right after a
 * tick) was dropped and the interface kept showing a stale state.
 */
export class StatusThrottle<T> {
  private last: T | null = null;
  private lastAt = 0;
  private pending: T | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly send: (status: T) => void,
    private readonly isDiscreteChange: (previous: T, next: T) => boolean,
    private readonly intervalMs = 100,
    private readonly now: () => number = () => Date.now(),
  ) {}

  push(status: T): void {
    const now = this.now();
    if (this.last === null || this.isDiscreteChange(this.last, status) || now - this.lastAt >= this.intervalMs) {
      this.flush(status, now);
      return;
    }
    this.pending = status;
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.pending !== null) this.flush(this.pending, this.now());
      }, Math.max(0, this.intervalMs - (now - this.lastAt)));
    }
  }

  /** Forget everything and cancel a held-back send (player torn down). */
  reset(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.last = null;
    this.lastAt = 0;
  }

  private flush(status: T, now: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.last = status;
    this.lastAt = now;
    this.send(status);
  }
}
