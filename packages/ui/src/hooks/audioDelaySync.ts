/**
 * Decides when to move mpv's audio delay to match the paced video's lag.
 *
 * Every audio-delay change is a small audible adjustment, so the delay is set
 * once from a measured window (not a frame-rate guess, which was wrong for
 * 50/60 fps streams) and afterwards moved only for a sustained change: two
 * windows in a row off by more than the tolerance, in the same direction.
 * Startup jitter and a single stall no longer step the audio around.
 */

export interface AudioDelayState {
  /** Delay last sent to mpv in ms; 0 means none yet for this stream */
  reported: number;
  /** A window that disagreed with `reported`, waiting for confirmation */
  candidate: number | null;
}

export const AUDIO_DELAY_MIN_SAMPLES = 20;
export const AUDIO_DELAY_TOLERANCE_MS = 40;

export function createAudioDelayState(): AudioDelayState {
  return { reported: 0, candidate: null };
}

/**
 * Feed one measurement window (mean presentation lag and how many frames it
 * covered). Returns the delay to send to mpv, or null to leave it alone.
 */
export function nextAudioDelay(state: AudioDelayState, windowDelayMs: number, samples: number): number | null {
  if (samples < AUDIO_DELAY_MIN_SAMPLES || !Number.isFinite(windowDelayMs)) return null;

  if (state.reported === 0) {
    state.reported = windowDelayMs;
    state.candidate = null;
    return windowDelayMs;
  }

  const offBy = windowDelayMs - state.reported;
  if (Math.abs(offBy) <= AUDIO_DELAY_TOLERANCE_MS) {
    state.candidate = null;
    return null;
  }

  const candidate = state.candidate;
  if (candidate !== null && Math.sign(candidate - state.reported) === Math.sign(offBy)) {
    const next = (candidate + windowDelayMs) / 2;
    state.reported = next;
    state.candidate = null;
    return next;
  }

  state.candidate = windowDelayMs;
  return null;
}
