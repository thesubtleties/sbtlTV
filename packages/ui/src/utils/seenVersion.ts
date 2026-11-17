import { useUIStore } from '../stores/uiStore';
import { saveSettings } from './saveSettings';

/** Records the version whose What's new this computer has seen (or had nothing to see). */
export function rememberSeenVersion(version: string): void {
  if (useUIStore.getState().settings.lastSeenVersion === version) return;
  useUIStore.getState().updateSettings({ lastSeenVersion: version });
  void saveSettings({ lastSeenVersion: version });
}

/** The same, for the version running now. */
export function rememberThisVersion(): Promise<void> {
  return window.platform?.getVersion().then(rememberSeenVersion, () => undefined) ?? Promise.resolve();
}
