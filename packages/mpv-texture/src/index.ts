/**
 * TypeScript bindings for mpv-texture native addon
 *
 * Provides GPU-accelerated video playback via libmpv with zero-copy
 * texture sharing for Electron's sharedTexture API.
 */

import { join, dirname } from 'path';
import { existsSync } from 'fs';

// Load the native addon
// In development, it's in build/Release
// In production, it should be in the same directory or node_modules
let addon: NativeAddon;

// Calculate paths relative to this file
const distDir = __dirname;
const packageDir = dirname(distDir);

const paths = [
  join(packageDir, 'build', 'Release', 'mpv_texture.node'),
  join(distDir, 'mpv_texture.node'),
  join(packageDir, 'mpv_texture.node'),
];

let loadedPath = '';
for (const p of paths) {
  if (existsSync(p)) {
    try {
      addon = require(p);
      loadedPath = p;
      break;
    } catch (e) {
      console.warn(`[mpv-texture] Failed to load from ${p}:`, e);
    }
  }
}

if (!addon!) {
  throw new Error(`[mpv-texture] Native addon not found. Searched:\n${paths.join('\n')}`);
}

console.log(`[mpv-texture] Loaded native addon from: ${loadedPath}`);

/**
 * Texture format for shared textures
 */
export type TextureFormat = 'rgba' | 'nv12' | 'bgra';

/**
 * Information about an exported texture frame
 */
export interface TextureInfo {
  /** Platform-specific handle (HANDLE on Windows, IOSurfaceID on macOS) */
  handle: bigint;
  /** Texture width in pixels */
  width: number;
  /** Texture height in pixels */
  height: number;
  /** Pixel format */
  format: TextureFormat;
}

/**
 * Playback status information
 */
export interface MpvStatus {
  /** Whether playback is active */
  playing: boolean;
  /** Volume level (0-100) */
  volume: number;
  /** Whether audio is muted */
  muted: boolean;
  /** Current playback position in seconds */
  position: number;
  /** Total duration in seconds */
  duration: number;
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
}

/**
 * Configuration options for creating the context
 */
export interface MpvConfig {
  /** Initial texture width (default: 1920) */
  width?: number;
  /** Initial texture height (default: 1080) */
  height?: number;
  /** Hardware decoding mode: 'auto', 'd3d11va', 'videotoolbox', etc. (default: 'auto') */
  hwdec?: string;
}

/**
 * Native addon interface
 */
interface NativeAddon {
  create(config?: MpvConfig): void;
  destroy(): void;
  load(url: string): Promise<void>;
  play(): void;
  pause(): void;
  stop(): void;
  seek(position: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  getStatus(): MpvStatus | undefined;
  onFrame(callback: (info: TextureInfo) => void): void;
  onStatus(callback: (status: MpvStatus) => void): void;
  onError(callback: (error: string) => void): void;
  releaseFrame(): void;
  isInitialized(): boolean;
}

/**
 * Frame callback type
 */
export type FrameCallback = (info: TextureInfo) => void;

/**
 * Status callback type
 */
export type StatusCallback = (status: MpvStatus) => void;

/**
 * Error callback type
 */
export type ErrorCallback = (error: string) => void;

/**
 * MpvTexture class - high-level wrapper for the native addon
 *
 * @example
 * ```typescript
 * const mpv = new MpvTexture();
 * mpv.create({ width: 1920, height: 1080, hwdec: 'auto' });
 *
 * mpv.onFrame((textureInfo) => {
 *   // Import texture via Electron's sharedTexture API
 *   const imported = sharedTexture.importSharedTexture({
 *     textureInfo,
 *     allReferenceReleased: () => mpv.releaseFrame()
 *   });
 *   sharedTexture.sendToRenderer(window.webContents, imported, frameIdx++);
 * });
 *
 * mpv.onStatus((status) => {
 *   console.log('Position:', status.position, '/', status.duration);
 * });
 *
 * await mpv.load('https://example.com/video.m3u8');
 * mpv.play();
 * ```
 */
export class MpvTexture {
  private _initialized = false;

  /**
   * Create and initialize the mpv context
   *
   * @param config - Configuration options
   * @throws Error if context creation fails
   */
  create(config?: MpvConfig): void {
    if (this._initialized) {
      throw new Error('Context already created');
    }

    addon.create(config);
    this._initialized = true;
  }

  /**
   * Destroy the mpv context and release all resources
   */
  destroy(): void {
    if (!this._initialized) return;

    addon.destroy();
    this._initialized = false;
  }

  /**
   * Check if the context is initialized
   */
  get isInitialized(): boolean {
    return this._initialized && addon.isInitialized();
  }

  /**
   * Load a media URL
   *
   * @param url - URL to load (file://, http://, https://, or stream URL)
   * @returns Promise that resolves when loading starts
   */
  load(url: string): Promise<void> {
    this.ensureInitialized();
    return addon.load(url);
  }

  /**
   * Start or resume playback
   */
  play(): void {
    this.ensureInitialized();
    addon.play();
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.ensureInitialized();
    addon.pause();
  }

  /**
   * Stop playback completely
   */
  stop(): void {
    this.ensureInitialized();
    addon.stop();
  }

  /**
   * Seek to a specific position
   *
   * @param position - Position in seconds
   */
  seek(position: number): void {
    this.ensureInitialized();
    addon.seek(position);
  }

  /**
   * Set the volume level
   *
   * @param volume - Volume level (0-100)
   */
  setVolume(volume: number): void {
    this.ensureInitialized();
    addon.setVolume(Math.max(0, Math.min(100, volume)));
  }

  /**
   * Toggle mute state
   */
  toggleMute(): void {
    this.ensureInitialized();
    addon.toggleMute();
  }

  /**
   * Get the current playback status
   *
   * @returns Current status or undefined if not initialized
   */
  getStatus(): MpvStatus | undefined {
    if (!this._initialized) return undefined;
    return addon.getStatus();
  }

  /**
   * Set callback for new frame events
   *
   * Called whenever a new video frame is ready for display.
   * The TextureInfo contains the platform-specific handle needed
   * for Electron's sharedTexture API.
   *
   * @param callback - Function to call with texture info
   */
  onFrame(callback: FrameCallback): void {
    this.ensureInitialized();
    addon.onFrame(callback);
  }

  /**
   * Set callback for status change events
   *
   * Called whenever playback status changes (position, playing state, etc.)
   *
   * @param callback - Function to call with status
   */
  onStatus(callback: StatusCallback): void {
    this.ensureInitialized();
    addon.onStatus(callback);
  }

  /**
   * Set callback for error events
   *
   * @param callback - Function to call with error message
   */
  onError(callback: ErrorCallback): void {
    this.ensureInitialized();
    addon.onError(callback);
  }

  /**
   * Release the current frame
   *
   * Must be called after Electron has finished using the texture
   * (in the allReferenceReleased callback of importSharedTexture).
   */
  releaseFrame(): void {
    if (this._initialized) {
      addon.releaseFrame();
    }
  }

  private ensureInitialized(): void {
    if (!this._initialized) {
      throw new Error('Context not initialized. Call create() first.');
    }
  }
}

// Export a singleton instance for convenience
export const mpvTexture = new MpvTexture();

// Also export the class for those who want multiple instances (not recommended)
export default MpvTexture;
