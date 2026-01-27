# sbtlTV

A desktop IPTV player built with Electron and mpv.

## Features

- **Live TV** - Browse channels by category, view EPG program guide
- **Movies** - Browse and play VOD movies with TMDB metadata matching
- **TV Series** - Browse series with season/episode navigation
- **mpv Player** - Hardware-accelerated playback via libmpv
- **Multi-source** - Add multiple IPTV sources (Xtream Codes API)
- **Stream Fallback** - Automatic URL format fallback (.ts → .m3u8 → .m3u)
- **Offline Database** - IndexedDB storage for channels, EPG, and VOD catalog

## Installation

Download the latest release for your platform from the [Releases](../../releases) page:

- **Windows**: `.exe` installer (mpv included) ✅ *tested*
- **macOS**: `.dmg` - ⚠️ *mpv bundling issue being debugged, fix coming soon* ([#13](../../issues/13))
- **Linux**: `.AppImage` or `.deb` (requires mpv - see below) - *untested, feedback welcome*

### Linux / macOS Intel Users

mpv must be installed separately:

```bash
# macOS (Intel)
brew install mpv

# Ubuntu/Debian
sudo apt install mpv

# Fedora
sudo dnf install mpv

# Arch
sudo pacman -S mpv
```

### Linux (libmpv GPU renderer)

On Linux, sbtlTV uses a native libmpv addon (no external mpv process). It creates an OpenGL context via EGL and renders frames through libmpv into a shared buffer that the UI draws to a canvas. Context priority is `x11egl → wayland → x11`.

Build/runtime requirements (names vary by distro):
- libmpv development headers
- EGL/OpenGL development headers (Mesa)
- X11 and Wayland client headers

Run in dev with `pnpm dev`. Wayland sessions are supported; Electron uses an ozone hint of `auto` by default.

## Building from Source

### Prerequisites

- Node.js 20+
- pnpm 10+
- mpv installed (for development)

### Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run in development mode
pnpm dev
```

### Building Distributables

```bash
# Download mpv for bundling (Windows/macOS)
bash scripts/download-mpv.sh

# Build for current platform
pnpm dist

# Build for specific platform
pnpm dist:win    # Windows
pnpm dist:mac    # macOS
pnpm dist:linux  # Linux
```

Output files will be in the `release/` directory.

### Bundling FFmpeg + libmpv (Linux/macOS)

For custom IPTV-focused builds, use:

```bash
bash scripts/build-ffmpeg.sh
bash scripts/build-libmpv.sh
bash scripts/download-licenses.sh
```

Details, codec/protocol list, and licensing notes: `docs/mpv-bundling.md`.

Troubleshooting (Linux libmpv):
- Verify the URL with system mpv:
  - `mpv --no-config --msg-level=all=v "<URL>"`
- If it fails there too, it is likely the stream, headers, or geo/TLS.
- Increase libmpv log verbosity:
  - `SBTLTV_MPV_LOG_LEVEL=debug pnpm dev`
- Persist mpv logs to a file:
  - `SBTLTV_MPV_LOG_FILE=/tmp/sbtltv-mpv.log pnpm dev`

## Configuration

### Adding Sources

1. Open Settings (gear icon in sidebar)
2. Go to the Sources tab
3. Click "Add Source"
4. Enter your Xtream Codes credentials:
   - Server URL
   - Username
   - Password
5. Click "Sync" to fetch channels and VOD catalog

### Data Location

User data is stored in:
- **Windows**: `%APPDATA%/sbtlTV`
- **macOS**: `~/Library/Application Support/sbtlTV`
- **Linux**: `~/.config/sbtlTV`

This includes your sources configuration and cached data. App updates do not affect user data.

## Project Structure

```
packages/
├── core/        # Shared types and utilities
├── electron/    # Electron main process, mpv integration
├── local-adapter/  # Local file adapter (future)
└── ui/          # React frontend (Vite)
```

## License

[GNU Affero General Public License v3.0](LICENSE)
