/**
 * mpv-shared-texture.ts
 *
 * Electron main process integration for @sbtltv/mpv-texture
 * Handles zero-copy GPU rendering from mpv to Electron via sharedTexture API
 */

import { sharedTexture, BrowserWindow, ipcMain } from 'electron';
import type { MpvController, RenderResult, TextureInfo } from '@sbtltv/mpv-texture';

// Dynamic import to handle missing native module gracefully
let mpvTexture: typeof import('@sbtltv/mpv-texture') | null = null;

let controller: MpvController | null = null;
let renderInterval: ReturnType<typeof setInterval> | null = null;
let targetWindow: BrowserWindow | null = null;
let isInitialized = false;

// Track mpv state for IPC
interface MpvState {
  playing: boolean;
  volume: number;
  muted: boolean;
  position: number;
  duration: number;
}

const mpvState: MpvState = {
  playing: false,
  volume: 100,
  muted: false,
  position: 0,
  duration: 0,
};

// Property observer unsubscribe functions
const propertyUnsubscribers: Array<() => void> = [];

export interface SharedTextureMpvOptions {
  width: number;
  height: number;
  frameRate?: number;
}

/**
 * Check if shared texture mode is supported
 */
export async function isSharedTextureSupported(): Promise<boolean> {
  try {
    if (!mpvTexture) {
      mpvTexture = await import('@sbtltv/mpv-texture');
    }
    return mpvTexture.isSupported();
  } catch {
    console.log('[mpv-shared-texture] Native module not available');
    return false;
  }
}

/**
 * Initialize shared texture mpv mode
 */
export async function initSharedTextureMpv(
  window: BrowserWindow,
  options: SharedTextureMpvOptions
): Promise<void> {
  if (isInitialized) {
    console.warn('[mpv-shared-texture] Already initialized');
    return;
  }

  // Load native module
  if (!mpvTexture) {
    mpvTexture = await import('@sbtltv/mpv-texture');
  }

  if (!mpvTexture.isSupported()) {
    throw new Error('Shared texture mode not supported on this platform');
  }

  targetWindow = window;

  // Create controller
  controller = mpvTexture.createMpvController({
    width: options.width,
    height: options.height,
  });

  await controller.init();

  // Set up property observers for state sync
  setupPropertyObservers();

  // Start render loop
  const frameRate = options.frameRate || 60;
  const frameInterval = 1000 / frameRate;

  renderInterval = setInterval(() => {
    renderFrame();
  }, frameInterval);

  // Handle window resize
  targetWindow.on('resize', handleResize);

  // Handle window close
  targetWindow.on('closed', () => {
    destroySharedTextureMpv();
  });

  isInitialized = true;
  console.log('[mpv-shared-texture] Initialized successfully');

  // Notify renderer that mpv is ready
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('mpv-ready', true);
  }
}

/**
 * Render a frame and send to renderer via sharedTexture
 */
async function renderFrame(): Promise<void> {
  if (!controller || !targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  try {
    const result = controller.render();
    if (!result || !result.needsDisplay) {
      return;
    }

    // Import the texture from mpv
    const imported = sharedTexture.importSharedTexture({
      textureInfo: result.textureInfo as any, // Type compatibility
    });

    // Send to renderer
    await sharedTexture.sendSharedTexture(
      {
        frame: targetWindow.webContents.mainFrame,
        importedSharedTexture: imported,
      },
      result.textureInfo.codedSize
    );
  } catch (error) {
    // Don't spam console on every frame error
    if (Math.random() < 0.01) {
      console.error('[mpv-shared-texture] Render error:', error);
    }
  }
}

/**
 * Handle window resize
 */
function handleResize(): void {
  if (!controller || !targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  const [width, height] = targetWindow.getContentSize();
  if (width > 0 && height > 0) {
    controller.resize(width, height);
  }
}

/**
 * Set up property observers for state sync
 */
function setupPropertyObservers(): void {
  if (!controller) return;

  // Observe pause state
  const unsubPause = controller.observeProperty('pause', (value) => {
    mpvState.playing = !value;
    sendStatusUpdate();
  });
  propertyUnsubscribers.push(unsubPause);

  // Observe volume
  const unsubVolume = controller.observeProperty('volume', (value) => {
    if (typeof value === 'number') {
      mpvState.volume = value;
      sendStatusUpdate();
    }
  });
  propertyUnsubscribers.push(unsubVolume);

  // Observe mute
  const unsubMute = controller.observeProperty('mute', (value) => {
    mpvState.muted = !!value;
    sendStatusUpdate();
  });
  propertyUnsubscribers.push(unsubMute);

  // Observe time position
  const unsubPos = controller.observeProperty('time-pos', (value) => {
    if (typeof value === 'number') {
      mpvState.position = value;
      sendStatusUpdate();
    }
  });
  propertyUnsubscribers.push(unsubPos);

  // Observe duration
  const unsubDuration = controller.observeProperty('duration', (value) => {
    if (typeof value === 'number') {
      mpvState.duration = value;
      sendStatusUpdate();
    }
  });
  propertyUnsubscribers.push(unsubDuration);
}

// Throttle status updates
let lastStatusUpdate = 0;
const STATUS_THROTTLE_MS = 100;

function sendStatusUpdate(): void {
  const now = Date.now();
  if (now - lastStatusUpdate < STATUS_THROTTLE_MS) {
    return;
  }
  lastStatusUpdate = now;

  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('mpv-status', { ...mpvState });
  }
}

/**
 * Load a media file
 */
export async function loadFile(url: string): Promise<void> {
  if (!controller) {
    throw new Error('mpv not initialized');
  }
  await controller.loadFile(url);
}

/**
 * Send an mpv command
 */
export async function sendCommand(cmd: string, ...args: unknown[]): Promise<void> {
  if (!controller) {
    throw new Error('mpv not initialized');
  }
  await controller.command(cmd, ...args);
}

/**
 * Get mpv property
 */
export function getProperty(name: string): unknown {
  if (!controller) {
    throw new Error('mpv not initialized');
  }
  return controller.getProperty(name);
}

/**
 * Set mpv property
 */
export function setProperty(name: string, value: unknown): void {
  if (!controller) {
    throw new Error('mpv not initialized');
  }
  controller.setProperty(name, value as string | number | boolean);
}

/**
 * Get current mpv state
 */
export function getStatus(): MpvState {
  return { ...mpvState };
}

/**
 * Check if initialized
 */
export function isReady(): boolean {
  return isInitialized && controller !== null;
}

/**
 * Destroy shared texture mpv
 */
export function destroySharedTextureMpv(): void {
  console.log('[mpv-shared-texture] Destroying...');

  // Stop render loop
  if (renderInterval) {
    clearInterval(renderInterval);
    renderInterval = null;
  }

  // Unsubscribe property observers
  for (const unsub of propertyUnsubscribers) {
    try {
      unsub();
    } catch {
      // Ignore errors during cleanup
    }
  }
  propertyUnsubscribers.length = 0;

  // Remove resize handler
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.removeListener('resize', handleResize);
  }

  // Destroy controller
  if (controller) {
    controller.destroy();
    controller = null;
  }

  targetWindow = null;
  isInitialized = false;

  console.log('[mpv-shared-texture] Destroyed');
}

/**
 * Register IPC handlers for shared texture mpv
 * Call this once during app initialization
 */
export function registerSharedTextureIpcHandlers(): void {
  // Load media
  ipcMain.handle('mpv-shared:load', async (_, url: string) => {
    try {
      await loadFile(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Play
  ipcMain.handle('mpv-shared:play', async () => {
    try {
      await sendCommand('set_property', 'pause', false);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Pause
  ipcMain.handle('mpv-shared:pause', async () => {
    try {
      await sendCommand('set_property', 'pause', true);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Toggle pause
  ipcMain.handle('mpv-shared:toggle-pause', async () => {
    try {
      await sendCommand('cycle', 'pause');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Stop
  ipcMain.handle('mpv-shared:stop', async () => {
    try {
      await sendCommand('stop');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Set volume
  ipcMain.handle('mpv-shared:volume', async (_, volume: number) => {
    try {
      setProperty('volume', Math.max(0, Math.min(100, volume)));
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Toggle mute
  ipcMain.handle('mpv-shared:toggle-mute', async () => {
    try {
      await sendCommand('cycle', 'mute');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Seek
  ipcMain.handle('mpv-shared:seek', async (_, seconds: number) => {
    try {
      await sendCommand('seek', seconds, 'relative');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get status
  ipcMain.handle('mpv-shared:get-status', () => {
    return getStatus();
  });

  // Check if shared texture mode is active
  ipcMain.handle('mpv-shared:is-active', () => {
    return isReady();
  });
}
