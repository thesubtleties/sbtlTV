import type { AppSettings } from '../types/electron';
import { useToastStore } from '../stores/toastStore';
import { debugLog } from './debugLog';

/**
 * Store settings in main. The change already applies on screen; if it could
 * not be stored it would quietly be gone after a restart, so say so.
 */
export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  if (!window.storage) return;
  try {
    const result = await window.storage.updateSettings(settings);
    if (result?.error) notSaved(result.error);
  } catch (err) {
    notSaved(err instanceof Error ? err.message : String(err));
  }
}

function notSaved(detail: string): void {
  debugLog(`settings not saved: ${detail}`, 'settings');
  useToastStore.getState().addToast({
    kind: 'error',
    title: 'Setting not saved',
    message: "It applies for now, but won't be kept after sbtlTV restarts.",
    duration: 8000,
  });
}
