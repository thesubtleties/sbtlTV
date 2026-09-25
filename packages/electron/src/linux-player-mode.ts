// Linux video player: 'native' renders inside the app window through the
// mpv-texture addon; 'compatibility' launches the external mpv window (the
// pre-0.10 "legacy" player). Read at startup, so a change needs a restart.
export type LinuxPlayerMode = 'native' | 'compatibility';

/**
 * Coerce a stored or incoming value to a player mode. Anything that is not
 * exactly 'compatibility' (missing, legacy, corrupted) means the default
 * native player, so a bad config value can never pick the wrong branch.
 */
export function normalizeLinuxPlayerMode(value: unknown): LinuxPlayerMode {
  return value === 'compatibility' ? 'compatibility' : 'native';
}
