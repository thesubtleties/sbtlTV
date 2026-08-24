/**
 * Bridge between mpv-texture native addon and Electron's sharedTexture API
 *
 * This module handles the integration of libmpv's GPU texture output
 * with Electron 40's sharedTexture API for zero-copy video rendering.
 */

import { BrowserWindow, sharedTexture, SharedTextureHandle } from 'electron';
import type { MpvTexture, MpvStatus, TextureInfo, MpvConfig } from '@sbtltv/mpv-texture';

/**
 * MpvTextureBridge - Integrates mpv-texture with Electron's sharedTexture API
 */
export class MpvTextureBridge {
  private mpv: MpvTexture | null = null;
  private window: BrowserWindow | null = null;
  private frameIndex = 0;
  private initialized = false;
  private activeSends = 0;
  private readonly maxConcurrentSends = 2;
  private pendingFrame: TextureInfo | null = null;
  private statusCallback?: (status: MpvStatus) => void;
  private errorCallback?: (error: string) => void;
  private pipelineFailureCallback?: (error: string) => void;
  private diagnosticsCallback?: (message: string) => void;
  private consecutiveErrors = 0;
  private pipelineFailureReported = false;

  // Diagnostics
  private stats = {
    received: 0,
    dropped: 0,
    sent: 0,
    errors: 0,
    importMs: 0,
    sendMs: 0,
    maxSendMs: 0,
    releaseMs: 0,
    maxReleaseMs: 0,
    sendCount: 0,
    releaseCount: 0,
  };
  private statsInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Initialize the bridge with the target window
   *
   * @param window - BrowserWindow to send frames to
   * @param config - mpv configuration
   */
  async initialize(
    window: BrowserWindow,
    config?: MpvConfig
  ): Promise<boolean> {
    this.window = window;

    try {
      // Dynamic import of the native addon
      // This allows the app to run without the addon (falling back to external mpv)
      const mpvModule = await import('@sbtltv/mpv-texture');
      this.mpv = mpvModule.mpvTexture;
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

      this.statsInterval = setInterval(() => {
        if (this.stats.received === 0) return;
        const avgImport = this.stats.sendCount > 0 ? (this.stats.importMs / this.stats.sendCount).toFixed(1) : '?';
        const avgSend = this.stats.sendCount > 0 ? (this.stats.sendMs / this.stats.sendCount).toFixed(1) : '?';
        const avgRelease = this.stats.releaseCount > 0 ? (this.stats.releaseMs / this.stats.releaseCount).toFixed(1) : '?';
        const message = `[MpvTextureBridge] sent:${this.stats.sent}/2s drop:${this.stats.dropped} mpv:${this.stats.received} err:${this.stats.errors} | import:${avgImport}ms send:${avgSend}/${this.stats.maxSendMs.toFixed(1)}ms release:${avgRelease}/${this.stats.maxReleaseMs.toFixed(1)}ms`;
        console.log(message);
        this.diagnosticsCallback?.(message);
        this.stats = {
          received: 0,
          dropped: 0,
          sent: 0,
          errors: 0,
          importMs: 0,
          sendMs: 0,
          maxSendMs: 0,
          releaseMs: 0,
          maxReleaseMs: 0,
          sendCount: 0,
          releaseCount: 0,
        };
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
   * Keeps up to two transfers in flight. A single newest frame is retained
   * while both transfer slots are busy.
   */
  private handleFrame(textureInfo: TextureInfo): void {
    if (!this.window || !this.mpv) {
      this.releaseFrame(textureInfo);
      return;
    }

    this.stats.received++;

    if (this.activeSends >= this.maxConcurrentSends) {
      if (this.pendingFrame) {
        this.stats.dropped++;
        this.releaseFrame(this.pendingFrame);
      }
      this.pendingFrame = textureInfo;
      return;
    }

    this.startSend(textureInfo);
  }

  private startSend(textureInfo: TextureInfo): void {
    this.activeSends++;
    void this.sendFrame(textureInfo).finally(() => {
      this.activeSends--;
      if (!this.pendingFrame || this.activeSends >= this.maxConcurrentSends) return;
      const nextFrame = this.pendingFrame;
      this.pendingFrame = null;
      this.startSend(nextFrame);
    });
  }

  private async sendFrame(textureInfo: TextureInfo): Promise<void> {
    let imported: ReturnType<typeof sharedTexture.importSharedTexture> | null = null;
    let releaseManagedByElectron = false;
    try {
      if (!this.window || this.window.isDestroyed()) return;
      const frameOwner = this.mpv;
      const frameStartedAt = performance.now();
      let sharedTextureHandle: SharedTextureHandle;
      if (textureInfo.kind === 'ioSurface') {
        const ioSurfaceBuffer = Buffer.alloc(8);
        ioSurfaceBuffer.writeBigUInt64LE(textureInfo.handle);
        sharedTextureHandle = { ioSurface: ioSurfaceBuffer };
      } else if (textureInfo.kind === 'ntHandle') {
        const handleBuffer = Buffer.alloc(8);
        handleBuffer.writeBigUInt64LE(textureInfo.handle);
        sharedTextureHandle = { ntHandle: handleBuffer };
      } else {
        sharedTextureHandle = { nativePixmap: textureInfo.nativePixmap };
      }

      const t0 = performance.now();

      imported = sharedTexture.importSharedTexture({
        textureInfo: {
          handle: sharedTextureHandle,
          codedSize: { width: textureInfo.width, height: textureInfo.height },
          visibleRect: { x: 0, y: 0, width: textureInfo.width, height: textureInfo.height },
          pixelFormat: textureInfo.format === 'nv12' ? 'rgba' : textureInfo.format,
        },
        ...(textureInfo.kind === 'nativePixmap' ? {
          allReferencesReleased: () => {
            const releaseMs = performance.now() - frameStartedAt;
            this.stats.releaseMs += releaseMs;
            this.stats.maxReleaseMs = Math.max(this.stats.maxReleaseMs, releaseMs);
            this.stats.releaseCount++;
            if (frameOwner?.isInitialized) frameOwner.releaseFrame(textureInfo.bufferId);
          },
        } : {}),
      });
      releaseManagedByElectron = textureInfo.kind === 'nativePixmap';

      const t1 = performance.now();

      await sharedTexture.sendSharedTexture(
        {
          frame: this.window.webContents.mainFrame,
          importedSharedTexture: imported,
        },
        this.frameIndex++
      );

      const t2 = performance.now();
      this.stats.importMs += t1 - t0;
      this.stats.sendMs += t2 - t1;
      this.stats.maxSendMs = Math.max(this.stats.maxSendMs, t2 - t1);
      this.stats.sendCount++;
      this.stats.sent++;
      this.consecutiveErrors = 0;
      this.pipelineFailureReported = false;
    } catch (error) {
      this.stats.errors++;
      this.consecutiveErrors++;
      if (this.consecutiveErrors === 1 || this.consecutiveErrors === 5) {
        console.error(`[MpvTextureBridge] Frame error (${this.consecutiveErrors} consecutive):`, error);
      }
      if (this.consecutiveErrors >= 5 && !this.pipelineFailureReported) {
        this.pipelineFailureReported = true;
        this.pipelineFailureCallback?.(`Shared texture pipeline failed after ${this.consecutiveErrors} consecutive frame errors`);
      }
    } finally {
      if (!releaseManagedByElectron) this.releaseFrame(textureInfo);
      imported?.release();
    }
  }

  /**
   * Load a media URL
   */
  async load(url: string, options?: string): Promise<void> {
    if (!this.mpv || !this.initialized) {
      throw new Error('Bridge not initialized');
    }
    // Clear stale frame in renderer and discard any queued frame
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('video-clear');
    }
    if (this.pendingFrame) this.releaseFrame(this.pendingFrame);
    this.pendingFrame = null;
    return this.mpv.load(url, options);
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

  onPipelineFailure(callback: (error: string) => void): void {
    this.pipelineFailureCallback = callback;
  }

  onDiagnostics(callback: (message: string) => void): void {
    this.diagnosticsCallback = callback;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized && (this.mpv?.isInitialized ?? false);
  }

  /**
   * Destroy and clean up
   */
  destroy(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.pendingFrame) {
      this.releaseFrame(this.pendingFrame);
      this.pendingFrame = null;
    }
    if (this.mpv) {
      this.mpv.destroy();
      this.mpv = null;
    }
    this.window = null;
    this.initialized = false;
    console.log('[MpvTextureBridge] Destroyed');
  }

  private releaseFrame(textureInfo: TextureInfo): void {
    if (textureInfo.kind === 'nativePixmap') {
      this.mpv?.releaseFrame(textureInfo.bufferId);
    }
  }
}
