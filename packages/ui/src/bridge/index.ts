import { createWindowBridge } from './window';
import { createPlatformBridge } from './platform';
import { createStorageBridge } from './storage';
import { createFetchProxyBridge } from './fetch-proxy';
import { createMpvBridge } from './mpv';

/**
 * Initialize the Tauri bridge by assigning window.* globals
 * that match the Electron preload API shape.
 *
 * Must be called before React renders.
 */
export async function initBridge(): Promise<void> {
  // Detect if running in Tauri
  if (!('__TAURI_INTERNALS__' in window)) {
    // Not in Tauri — running in browser dev or Electron, skip bridge init
    return;
  }

  window.electronWindow = createWindowBridge();
  window.storage = createStorageBridge();
  window.fetchProxy = createFetchProxyBridge();
  window.mpv = createMpvBridge();
  window.platform = await createPlatformBridge();
}
