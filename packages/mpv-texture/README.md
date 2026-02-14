# @sbtltv/mpv-texture

Native N-API addon for GPU-accelerated video playback using libmpv with zero-copy texture sharing for Electron's sharedTexture API.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  libmpv         │────▶│  N-API Addon     │────▶│  Electron Main  │
│  (decode/render)│     │  (texture export)│     │  sharedTexture  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │                        │
         ▼                       ▼                        ▼
    GPU Texture  ───▶  DXGI Handle (Win)  ───▶  VideoFrame  ───▶  WebGPU
                       IOSurface (Mac)
```

## Prerequisites

### Windows
- Visual Studio 2019+ with C++ build tools
- libmpv development files in `deps/mpv/win64/`
- Node.js 18+

### macOS
- Xcode Command Line Tools
- libmpv development files in `deps/mpv/macos/`
- Node.js 18+

## Building

```bash
# Install dependencies
npm install

# Build native addon and TypeScript
npm run build

# Or build native only
npm run build:native

# Clean build artifacts
npm run clean
```

## Usage

### Basic Usage

```typescript
import { MpvTexture } from '@sbtltv/mpv-texture';

const mpv = new MpvTexture();

// Create context
mpv.create({
  width: 1920,
  height: 1080,
  hwdec: 'auto' // or 'd3d11va', 'videotoolbox', etc.
});

// Set up callbacks
mpv.onFrame((textureInfo) => {
  console.log('New frame:', textureInfo.width, 'x', textureInfo.height);
  // Use with Electron's sharedTexture API
});

mpv.onStatus((status) => {
  console.log('Position:', status.position, '/', status.duration);
});

mpv.onError((error) => {
  console.error('Error:', error);
});

// Load and play
await mpv.load('https://example.com/stream.m3u8');
mpv.play();

// Control playback
mpv.pause();
mpv.seek(30); // seconds
mpv.setVolume(80); // 0-100
mpv.toggleMute();

// Clean up
mpv.destroy();
```

### Electron Integration

```typescript
// main.ts
import { sharedTexture } from 'electron';
import { MpvTextureBridge } from './mpv-texture-bridge';

const bridge = new MpvTextureBridge();
await bridge.initialize(mainWindow, { hwdec: 'auto' });

await bridge.load(streamUrl);
bridge.play();

// Frames are automatically sent to renderer via sharedTexture
```

```typescript
// preload.ts
import { sharedTexture } from 'electron';

sharedTexture.receiveFromMain((imported, index) => {
  const videoFrame = imported.getVideoFrame();
  // Render videoFrame via WebGPU or Canvas
  videoFrame.close();
  imported.release();
});
```

## API Reference

### MpvTexture

#### `create(config?: MpvConfig): void`
Create and initialize the mpv context.

#### `destroy(): void`
Destroy the context and release resources.

#### `load(url: string): Promise<void>`
Load a media URL.

#### `play(): void`
Start playback.

#### `pause(): void`
Pause playback.

#### `stop(): void`
Stop playback.

#### `seek(position: number): void`
Seek to position in seconds.

#### `setVolume(volume: number): void`
Set volume (0-100).

#### `toggleMute(): void`
Toggle mute state.

#### `getStatus(): MpvStatus`
Get current playback status.

#### `onFrame(callback: FrameCallback): void`
Set callback for new frames.

#### `onStatus(callback: StatusCallback): void`
Set callback for status changes.

#### `onError(callback: ErrorCallback): void`
Set callback for errors.

#### `releaseFrame(): void`
Release the current frame (call when Electron is done with texture).

### TextureInfo

```typescript
interface TextureInfo {
  handle: bigint;           // Platform-specific handle
  width: number;            // Texture width
  height: number;           // Texture height
  format: 'rgba' | 'nv12' | 'bgra';
}
```

### MpvStatus

```typescript
interface MpvStatus {
  playing: boolean;
  volume: number;
  muted: boolean;
  position: number;
  duration: number;
  width: number;
  height: number;
}
```

## Platform Notes

### Windows
Uses WGL_NV_DX_interop for OpenGL/D3D11 interop. Requires NVIDIA or AMD GPU with driver support.

### macOS
Uses IOSurface for texture sharing. Works with Metal/OpenGL.

## Bundling libmpv

Place libmpv files in `deps/mpv/`:

```
deps/mpv/
├── include/
│   └── mpv/
│       ├── client.h
│       └── render.h
├── win64/
│   ├── mpv.lib
│   └── mpv-2.dll
└── macos/
    └── libmpv.dylib
```

## License

MPL-2.0 (same as sbtlTV)
