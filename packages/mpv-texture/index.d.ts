/**
 * @sbtltv/mpv-texture
 * Native Node.js addon for mpv rendering to Electron shared textures
 */

export interface MpvTextureOptions {
  /** Initial width of the render texture */
  width: number;
  /** Initial height of the render texture */
  height: number;
  /** Path to mpv library (auto-detected if not provided) */
  mpvPath?: string;
  /** Path to mpv config directory */
  mpvConfigDir?: string;
}

export interface TextureHandle {
  /** macOS: IOSurface ID as Buffer */
  ioSurface?: Buffer;
  /** Windows: NT HANDLE as Buffer */
  ntHandle?: Buffer;
  /** Linux: DMA-BUF info (future) */
  nativePixmap?: {
    planes: Array<{
      fd: number;
      stride: number;
      offset: number;
      size: number;
    }>;
    modifier: string;
    supportsZeroCopyWebGpuImport: boolean;
  };
}

export interface TextureInfo {
  /** Pixel format: 'rgba' | 'bgra' */
  pixelFormat: 'rgba' | 'bgra';
  /** Texture dimensions */
  codedSize: {
    width: number;
    height: number;
  };
  /** Visible region (usually full texture) */
  visibleRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Platform-specific handle for sharedTexture.importSharedTexture() */
  handle: TextureHandle;
  /** Timestamp in microseconds (optional) */
  timestamp?: number;
}

export interface RenderResult {
  /** Whether a new frame was rendered */
  needsDisplay: boolean;
  /** Texture info for Electron's sharedTexture API */
  textureInfo: TextureInfo;
}

export interface MpvController {
  /**
   * Initialize the mpv render context
   * Must be called before any other methods
   */
  init(): Promise<void>;

  /**
   * Load a media file or URL
   * @param url - File path or URL to load
   */
  loadFile(url: string): Promise<void>;

  /**
   * Render a frame to the shared texture
   * @returns Render result with textureInfo, or null if no new frame
   */
  render(): RenderResult | null;

  /**
   * Resize the render texture
   * @param width - New width
   * @param height - New height
   */
  resize(width: number, height: number): void;

  /**
   * Send an mpv command
   * @param cmd - Command name (e.g., 'seek', 'pause', 'quit')
   * @param args - Command arguments
   */
  command(cmd: string, ...args: (string | number | boolean)[]): Promise<void>;

  /**
   * Get an mpv property value
   * @param name - Property name (e.g., 'pause', 'time-pos', 'duration')
   */
  getProperty(name: string): string | number | boolean | null;

  /**
   * Set an mpv property value
   * @param name - Property name
   * @param value - New value
   */
  setProperty(name: string, value: string | number | boolean): void;

  /**
   * Observe an mpv property for changes
   * @param name - Property name to observe
   * @param callback - Called when property changes
   * @returns Unsubscribe function
   */
  observeProperty(name: string, callback: (value: unknown) => void): () => void;

  /**
   * Check if the controller is initialized
   */
  isInitialized(): boolean;

  /**
   * Destroy the controller and free all resources
   * Must be called when done to prevent memory leaks
   */
  destroy(): void;
}

/**
 * Create a new MpvController instance
 * @param options - Controller options
 */
export function createMpvController(options: MpvTextureOptions): MpvController;

/**
 * Check if shared texture mode is supported on this platform
 * - macOS: Always true (uses IOSurface)
 * - Windows: True (uses D3D11 shared textures)
 * - Linux: False (DMA-BUF + WebGPU not ready in Electron)
 */
export function isSupported(): boolean;

/**
 * Get the current platform
 */
export function getPlatform(): 'darwin' | 'win32' | 'linux';

export { MpvController as MpvControllerClass };
