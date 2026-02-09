/**
 * Bridge between mpv-texture native addon and Electron's sharedTexture API
 *
 * This module handles the integration of libmpv's GPU texture output
 * with Electron 40's sharedTexture API for zero-copy video rendering.
 */

import { BrowserWindow, sharedTexture, SharedTextureHandle } from 'electron';

// Type definitions for the mpv-texture addon
// (These match the types from @sbtltv/mpv-texture)
interface TextureInfo {
  handle: bigint;
  width: number;
  height: number;
  format: 'rgba' | 'nv12' | 'bgra';
}

interface MpvStatus {
  playing: boolean;
  volume: number;
  muted: boolean;
  position: number;
  duration: number;
  width: number;
  height: number;
}

interface MpvTextureAddon {
  create(config?: { width?: number; height?: number; hwdec?: string }): void;
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
 * MpvTextureBridge - Integrates mpv-texture with Electron's sharedTexture API
 */
export class MpvTextureBridge {
  private mpv: MpvTextureAddon | null = null;
  private window: BrowserWindow | null = null;
  private frameIndex = 0;
  private initialized = false;
  private sending = false;
  private pendingFrame: TextureInfo | null = null;
  private statusCallback?: (status: MpvStatus) => void;
  private errorCallback?: (error: string) => void;

  // Diagnostics
  private stats = { received: 0, dropped: 0, sent: 0, errors: 0, importMs: 0, sendMs: 0, sendCount: 0 };
  private statsInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Initialize the bridge with the target window
   *
   * @param window - BrowserWindow to send frames to
   * @param config - mpv configuration
   */
  async initialize(
    window: BrowserWindow,
    config?: { width?: number; height?: number; hwdec?: string }
  ): Promise<boolean> {
    this.window = window;

    try {
      // Dynamic import of the native addon
      // This allows the app to run without the addon (falling back to external mpv)
      const mpvModule = await import('@sbtltv/mpv-texture');
      this.mpv = mpvModule.mpvTexture as unknown as MpvTextureAddon;
    } catch (error) {
      console.warn('[MpvTextureBridge] Failed to load mpv-texture addon:', error);
      return false;
    }

    try {
      // Create mpv context
      this.mpv.create(config);

      // Set up frame callback for sharedTexture integration
      this.mpv.onFrame((textureInfo) => {
        this.handleFrame(textureInfo);
      });

      // Set up status callback
      this.mpv.onStatus((status) => {
        this.statusCallback?.(status);
      });

      // Set up error callback
      this.mpv.onError((error) => {
        this.errorCallback?.(error);
      });

      this.initialized = true;
      console.log('[MpvTextureBridge] Initialized successfully');

      // Log frame stats every 2 seconds
      this.statsInterval = setInterval(() => {
        if (this.stats.received > 0) {
          const avgImport = this.stats.sendCount > 0 ? (this.stats.importMs / this.stats.sendCount).toFixed(1) : '?';
          const avgSend = this.stats.sendCount > 0 ? (this.stats.sendMs / this.stats.sendCount).toFixed(1) : '?';
          console.log(`[MpvTextureBridge] sent:${this.stats.sent}/2s drop:${this.stats.dropped} mpv:${this.stats.received} err:${this.stats.errors} | import:${avgImport}ms send:${avgSend}ms`);
          this.stats = { received: 0, dropped: 0, sent: 0, errors: 0, importMs: 0, sendMs: 0, sendCount: 0 };
        }
      }, 2000);

      return true;
    } catch (error) {
      console.error('[MpvTextureBridge] Failed to initialize:', error);
      return false;
    }
  }

  /**
   * Handle a new frame from mpv
   *
   * Stores the latest frame and kicks off the send loop. If a send is already
   * in progress, the frame is stored and will be picked up when the current
   * send completes — always sending the most recent frame available.
   */
  private handleFrame(textureInfo: TextureInfo): void {
    if (!this.window || !this.mpv) return;

    this.stats.received++;

    if (this.sending) {
      // Store latest, overwriting any previously pending frame
      this.stats.dropped++;
    }
    this.pendingFrame = textureInfo;

    if (!this.sending) {
      this.sendLoop();
    }
  }

  /**
   * Send loop - keeps sending the latest pending frame until none remain.
   * Only one instance runs at a time (guarded by this.sending).
   */
  private async sendLoop(): Promise<void> {
    if (!this.window) return;
    this.sending = true;

    while (this.pendingFrame) {
      const textureInfo = this.pendingFrame;
      this.pendingFrame = null;

      let imported: ReturnType<typeof sharedTexture.importSharedTexture> | null = null;
      try {
        // Convert handle to platform format
        let sharedTextureHandle: SharedTextureHandle;
        if (process.platform === 'darwin') {
          // handle contains the raw IOSurfaceRef pointer (8 bytes on arm64)
          const ioSurfaceBuffer = Buffer.alloc(8);
          ioSurfaceBuffer.writeBigUInt64LE(textureInfo.handle);
          sharedTextureHandle = { ioSurface: ioSurfaceBuffer };
        } else {
          const handleBuffer = Buffer.alloc(8);
          handleBuffer.writeBigUInt64LE(textureInfo.handle);
          sharedTextureHandle = { ntHandle: handleBuffer };
        }

        const t0 = performance.now();

        imported = sharedTexture.importSharedTexture({
          textureInfo: {
            handle: sharedTextureHandle,
            codedSize: { width: textureInfo.width, height: textureInfo.height },
            visibleRect: { x: 0, y: 0, width: textureInfo.width, height: textureInfo.height },
            pixelFormat: textureInfo.format === 'nv12' ? 'rgba' : textureInfo.format,
          },
        });

        const t1 = performance.now();

        await sharedTexture.sendSharedTexture(
          {
            frame: this.window!.webContents.mainFrame,
            importedSharedTexture: imported,
          },
          this.frameIndex++
        );

        const t2 = performance.now();
        this.stats.importMs += t1 - t0;
        this.stats.sendMs += t2 - t1;
        this.stats.sendCount++;
        this.stats.sent++;
      } catch (error) {
        this.stats.errors++;
        console.error('[MpvTextureBridge] Frame error:', error);
      } finally {
        imported?.release();
      }
    }

    this.sending = false;
  }

  /**
   * Load a media URL
   */
  async load(url: string): Promise<void> {
    if (!this.mpv || !this.initialized) {
      throw new Error('Bridge not initialized');
    }
    return this.mpv.load(url);
  }

  /**
   * Start playback
   */
  play(): void {
    this.mpv?.play();
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.mpv?.pause();
  }

  /**
   * Stop playback
   */
  stop(): void {
    this.mpv?.stop();
  }

  /**
   * Seek to position
   */
  seek(position: number): void {
    this.mpv?.seek(position);
  }

  /**
   * Set volume (0-100)
   */
  setVolume(volume: number): void {
    this.mpv?.setVolume(volume);
  }

  /**
   * Toggle mute
   */
  toggleMute(): void {
    this.mpv?.toggleMute();
  }

  /**
   * Get current status
   */
  getStatus(): MpvStatus | undefined {
    return this.mpv?.getStatus();
  }

  /**
   * Set status change callback
   */
  onStatus(callback: (status: MpvStatus) => void): void {
    this.statusCallback = callback;
  }

  /**
   * Set error callback
   */
  onError(callback: (error: string) => void): void {
    this.errorCallback = callback;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized && (this.mpv?.isInitialized() ?? false);
  }

  /**
   * Destroy and clean up
   */
  destroy(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.mpv) {
      this.mpv.destroy();
      this.mpv = null;
    }
    this.window = null;
    this.initialized = false;
    console.log('[MpvTextureBridge] Destroyed');
  }
}

// Singleton instance
export const mpvTextureBridge = new MpvTextureBridge();
