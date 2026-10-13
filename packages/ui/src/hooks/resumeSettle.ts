/**
 * A movie or episode that resumes saves no progress until playback has reached
 * the resume point: the first statuses of a load say 0 (the seek has not landed
 * yet), and saving those wiped the resume point when the viewer left within the
 * 15s save interval. If the seek never happens, playing on from the start for
 * 20s counts as settled.
 */
export function resumeSettled(position: number, resumeTarget: number | null): boolean {
  if (resumeTarget === null) return true;
  return position >= resumeTarget - 5 || position >= 20;
}
