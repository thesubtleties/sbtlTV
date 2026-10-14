// One-time settings changes when sbtlTV is updated. Pure, so it runs under
// node:test; storage.ts applies the result once at startup.

export interface TeamLogosState {
  /** The user's saved choice, if they ever made one */
  sportsMatchupEnabled?: boolean;
  /** Set once this decision has been made, so it never runs again */
  sportsDefaultSettled?: boolean;
}

/**
 * Team logos (loaded from ESPN) went from on to off by default in 0.12.1. An
 * install that already existed (it has a source) and never chose keeps them on,
 * as it had them; a new install starts off. A saved choice is never changed.
 * Returns the fields to save, or null when there is nothing to do.
 */
export function settleTeamLogosDefault(state: TeamLogosState, hasSources: boolean): TeamLogosState | null {
  if (state.sportsDefaultSettled) return null;
  if (state.sportsMatchupEnabled !== undefined || !hasSources) return { sportsDefaultSettled: true };
  return { sportsMatchupEnabled: true, sportsDefaultSettled: true };
}
