/**
 * Linux keyring for saved passwords. Chromium picks one at startup, from
 * --password-store or by guessing from the desktop, and a keyring other than the
 * one the passwords were saved with cannot read them. Two things move the guess:
 * the AppImage updater relaunches the new version without arguments (dropping a
 * --password-store from the user's launcher), and changing desktops (KDE to
 * Hyprland, say). So sbtlTV keeps the keyring it uses: the one named at launch,
 * else the first real keyring Chromium found, else the one picked in Settings >
 * Privacy. Switching there starts over with the new keyring (passwords and API
 * keys are entered again).
 */

/** Chromium's --password-store values on Linux. */
export const KEYRINGS = ['gnome-libsecret', 'kwallet6', 'kwallet5', 'kwallet', 'basic'] as const;
export type Keyring = (typeof KEYRINGS)[number];

export function isKeyring(value: unknown): value is Keyring {
  return typeof value === 'string' && (KEYRINGS as readonly string[]).includes(value);
}

/**
 * The keyring Chromium is using, as a --password-store value, from
 * safeStorage.getSelectedStorageBackend(); null when it has not said ('unknown').
 */
export function keyringOfBackend(backend: string): Keyring | null {
  if (backend === 'gnome_libsecret') return 'gnome-libsecret';
  if (backend === 'basic_text') return 'basic';
  return isKeyring(backend) ? backend : null;
}

/**
 * Before the keyring is opened. `launchValue` is the --password-store this launch
 * was given ('' when none, as app.commandLine.getSwitchValue reports it). A named
 * keyring wins and is kept (`remember`, when it differs); without one, the kept
 * keyring is put back (`apply`).
 */
export function resolvePasswordStore(launchValue: string, kept: string | null): { apply: Keyring | null; remember: Keyring | null } {
  if (launchValue) {
    return { apply: null, remember: isKeyring(launchValue) && launchValue !== kept ? launchValue : null };
  }
  return { apply: isKeyring(kept) ? kept : null, remember: null };
}

/**
 * After startup, with nothing kept yet: keep the keyring Chromium found, when it
 * is a real one. 'basic' (no keyring) is only kept when chosen, so a keyring set
 * up later is still found.
 */
export function keyringToKeep(kept: string | null, backend: string): Keyring | null {
  if (isKeyring(kept)) return null;
  const found = keyringOfBackend(backend);
  return found && found !== 'basic' ? found : null;
}
