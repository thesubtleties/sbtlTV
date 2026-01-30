# @sbtltv/mpv-texture

Native Node.js addon for rendering mpv video to Electron shared textures, enabling zero-copy GPU rendering.

## Overview

This package provides a native Node.js addon that:
1. Creates platform-specific shared textures (IOSurface on macOS, D3D11 on Windows)
2. Binds them to an OpenGL FBO
3. Uses libmpv's render API to render video frames to the FBO
4. Exports texture handles for Electron's `sharedTexture` API

This enables zero-copy GPU rendering: frames stay in VRAM from mpv → Electron → WebGPU.

## Requirements

- Node.js >= 18
- Electron >= 40 (for sharedTexture API)
- libmpv development files

### Platform-specific

**macOS:**
```bash
# Install mpv with Homebrew
brew install mpv

# Or use bundled mpv (handled by sbtlTV build)
```

**Windows:**
```bash
# Install via Chocolatey
choco install mpvio

# Or use bundled mpv (handled by sbtlTV build)
```

**Linux:**
```bash
# Install development files
sudo apt install libmpv-dev libegl1-mesa-dev libgbm-dev

# Note: Linux shared texture support requires Electron DMA-BUF + WebGPU,
# which is not yet available. Use fallback mode instead.
```

## Installation

```bash
cd packages/mpv-texture
pnpm install
```

This will compile the native addon using node-gyp.

## Platform Support

| Platform | Status | Texture Type |
|----------|--------|--------------|
| macOS | ✅ Supported | IOSurface |
| Windows | 🚧 In Progress | D3D11 HANDLE |
| Linux | ❌ Not Yet | DMA-BUF (waiting on Electron) |

## Usage

### Check Support

```javascript
const { isSupported, getPlatform } = require('@sbtltv/mpv-texture');

if (!isSupported()) {
  console.log('Falling back to --wid mode');
  // Use existing mpv process approach
}
```

### Basic Usage

```javascript
const { createMpvController } = require('@sbtltv/mpv-texture');

const controller = createMpvController({
  width: 1920,
  height: 1080,
});

await controller.init();
await controller.loadFile('video.mp4');

// Render loop (typically in setInterval at 60fps)
const result = controller.render();
if (result?.needsDisplay) {
  // result.textureInfo can be passed to sharedTexture.importSharedTexture()
  console.log('Frame rendered:', result.textureInfo);
}

// Cleanup
controller.destroy();
```

### With Electron sharedTexture API

```javascript
const { sharedTexture, BrowserWindow } = require('electron');
const { createMpvController } = require('@sbtltv/mpv-texture');

const controller = createMpvController({ width: 1920, height: 1080 });
await controller.init();
await controller.loadFile('video.mp4');

// Render loop
setInterval(async () => {
  const result = controller.render();
  if (!result?.needsDisplay) return;

  const imported = sharedTexture.importSharedTexture({
    textureInfo: result.textureInfo,
  });

  await sharedTexture.sendSharedTexture({
    frame: win.webContents.mainFrame,
    importedSharedTexture: imported,
  });
}, 1000 / 60);
```

### In Renderer (WebGPU)

```javascript
sharedTexture.setSharedTextureReceiver(async (data) => {
  const videoFrame = data.importedSharedTexture.getVideoFrame();
  const texture = device.importExternalTexture({ source: videoFrame });
  // Render with WebGPU...
  videoFrame.close();
  data.importedSharedTexture.release();
});
```

## API

See `index.d.ts` for full TypeScript definitions.

### `createMpvController(options)`

Create a new mpv controller.

**Options:**
- `width` (number, required): Initial texture width
- `height` (number, required): Initial texture height
- `mpvPath` (string, optional): Path to mpv library
- `mpvConfigDir` (string, optional): Path to mpv config directory

### `MpvController`

- `init()`: Initialize the mpv render context
- `loadFile(url)`: Load a media file or URL
- `render()`: Render a frame, returns `{ needsDisplay, textureInfo }` or null
- `resize(width, height)`: Resize the render texture
- `command(cmd, ...args)`: Send an mpv command
- `getProperty(name)`: Get an mpv property
- `setProperty(name, value)`: Set an mpv property
- `observeProperty(name, callback)`: Observe property changes
- `destroy()`: Free all resources

## Building

```bash
# Install dependencies
pnpm install

# Build native module
pnpm run build

# Build debug version
pnpm run build:debug

# Run tests
pnpm test
```

### Environment Variables

- `MPV_INCLUDE_DIR`: Path to mpv headers (default: /opt/homebrew/include)
- `MPV_LIB_DIR`: Path to mpv libraries (default: /opt/homebrew/lib)
- `MPV_DLL_PATH`: Path to mpv DLL (Windows only)

## Architecture

```
┌─────────────────────────────────────────┐
│         JavaScript (index.js)           │
└───────────────────┬─────────────────────┘
                    │ N-API
┌───────────────────┴─────────────────────┐
│         MpvController (C++)             │
│  - mpv_create, mpv_initialize           │
│  - mpv_render_context_create            │
│  - mpv_render_context_render            │
└───────────────────┬─────────────────────┘
                    │
┌───────────────────┴─────────────────────┐
│      SharedTextureManager (C++)         │
│  Platform abstraction for textures      │
└───────────────────┬─────────────────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
   ┌────┴────┐ ┌────┴────┐ ┌────┴────┐
   │ macOS   │ │ Windows │ │ Linux   │
   │IOSurface│ │ D3D11   │ │ DMA-BUF │
   └─────────┘ └─────────┘ └─────────┘
```

## License

MIT
