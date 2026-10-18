/**
 * Linux keyring for saved passwords. Chromium picks one at startup, from
 * --password-store or by guessing from the desktop, and a keyring other than the
 * one the passwords were saved with cannot read them. The AppImage updater
 * relaunches the new version without arguments, so a --password-store the user
 * launches with (common outside GNOME/KDE, e.g. Hyprland) is lost after an update.
 * We remember the one asked for and put it back on a launch that lacks it.
 */

/** Chromium's --password-store values on Linux. */
const KNOWN = new Set(['basic', 'gnome-libsecret', 'kwallet', 'kwallet5', 'kwallet6']);

/**
 * What this launch should do: `remember` a keyring named on the command line (when
 * it differs from the remembered one), or `apply` the remembered one when none is named.
 */
export function resolvePasswordStore(argv: string[], remembered: string | null): { apply: string | null; remember: string | null } {
  const arg = argv.find((a) => a.startsWith('--password-store='));
  if (arg) {
    const named = arg.slice('--password-store='.length);
    return { apply: null, remember: KNOWN.has(named) && named !== remembered ? named : null };
  }
  return { apply: remembered && KNOWN.has(remembered) ? remembered : null, remember: null };
}
