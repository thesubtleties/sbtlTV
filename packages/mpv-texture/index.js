/**
 * @sbtltv/mpv-texture
 * Native Node.js addon for mpv rendering to Electron shared textures
 */

const path = require('path');

let native = null;
let loadError = null;

// Try to load the native module
try {
  native = require('./build/Release/mpv_texture.node');
} catch (releaseErr) {
  try {
    native = require('./build/Debug/mpv_texture.node');
  } catch (debugErr) {
    loadError = new Error(
      `Failed to load mpv-texture native module.\n` +
      `Release error: ${releaseErr.message}\n` +
      `Debug error: ${debugErr.message}\n` +
      `Make sure you have run 'npm install' or 'node-gyp rebuild' in the mpv-texture package.`
    );
  }
}

/**
 * Check if shared texture mode is supported on this platform
 * @returns {boolean}
 */
function isSupported() {
  if (!native) return false;
  return native.isSupported();
}

/**
 * Get the current platform
 * @returns {string} 'darwin' | 'win32' | 'linux'
 */
function getPlatform() {
  if (!native) return process.platform;
  return native.getPlatform();
}

/**
 * MpvController wrapper class
 */
class MpvController {
  /**
   * @param {Object} options
   * @param {number} options.width - Initial texture width
   * @param {number} options.height - Initial texture height
   * @param {string} [options.mpvPath] - Path to mpv library (optional)
   * @param {string} [options.mpvConfigDir] - Path to mpv config directory (optional)
   */
  constructor(options) {
    if (!native) {
      throw loadError || new Error('Native module not available');
    }

    if (!options || typeof options.width !== 'number' || typeof options.height !== 'number') {
      throw new TypeError('Options must include width and height as numbers');
    }

    this._native = new native.MpvController(options);
    this._destroyed = false;
  }

  /**
   * Initialize the mpv render context
   * @returns {Promise<void>}
   */
  async init() {
    this._checkNotDestroyed();
    return this._native.init();
  }

  /**
   * Load a media file or URL
   * @param {string} url - File path or URL to load
   * @returns {Promise<void>}
   */
  async loadFile(url) {
    this._checkNotDestroyed();
    if (typeof url !== 'string') {
      throw new TypeError('URL must be a string');
    }
    return this._native.loadFile(url);
  }

  /**
   * Render a frame and get texture info
   * @returns {Object|null} Render result with textureInfo, or null if no new frame
   */
  render() {
    this._checkNotDestroyed();
    return this._native.render();
  }

  /**
   * Resize the render texture
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    this._checkNotDestroyed();
    this._native.resize(width, height);
  }

  /**
   * Send an mpv command
   * @param {string} cmd - Command name
   * @param {...any} args - Command arguments
   * @returns {Promise<void>}
   */
  async command(cmd, ...args) {
    this._checkNotDestroyed();
    return this._native.command(cmd, ...args);
  }

  /**
   * Get an mpv property value
   * @param {string} name - Property name
   * @returns {string|number|boolean|null}
   */
  getProperty(name) {
    this._checkNotDestroyed();
    return this._native.getProperty(name);
  }

  /**
   * Set an mpv property value
   * @param {string} name - Property name
   * @param {string|number|boolean} value - Property value
   */
  setProperty(name, value) {
    this._checkNotDestroyed();
    this._native.setProperty(name, value);
  }

  /**
   * Observe an mpv property for changes
   * @param {string} name - Property name
   * @param {Function} callback - Callback for property changes
   * @returns {Function} Unsubscribe function
   */
  observeProperty(name, callback) {
    this._checkNotDestroyed();
    this._native.observeProperty(name, callback);
    // TODO: Return proper unsubscribe function
    return () => {};
  }

  /**
   * Check if the controller is initialized
   * @returns {boolean}
   */
  isInitialized() {
    if (this._destroyed) return false;
    return this._native.isInitialized();
  }

  /**
   * Destroy the controller and free resources
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._native.destroy();
  }

  /**
   * @private
   */
  _checkNotDestroyed() {
    if (this._destroyed) {
      throw new Error('MpvController has been destroyed');
    }
  }
}

/**
 * Create a new MpvController instance
 * @param {Object} options
 * @param {number} options.width - Initial texture width
 * @param {number} options.height - Initial texture height
 * @param {string} [options.mpvPath] - Path to mpv library (optional)
 * @returns {MpvController}
 */
function createMpvController(options) {
  return new MpvController(options);
}

module.exports = {
  createMpvController,
  isSupported,
  getPlatform,
  MpvController,
};
