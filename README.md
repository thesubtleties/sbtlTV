# sbtlTV

A desktop IPTV player built with Electron, GStreamer (Linux, X11 only), and mpv (Windows/macOS).

## Features

- **Live TV** - Browse channels by category, view EPG program guide
- **Movies** - Browse and play VOD movies with TMDB metadata matching
- **TV Series** - Browse series with season/episode navigation
- **Playback** - GStreamer appsink (Linux, X11 enforced) and mpv (Windows/macOS)
- **Multi-source** - Add multiple IPTV sources (Xtream Codes API)
- **Stream Fallback** - Automatic URL format fallback (.ts → .m3u8 → .m3u)
- **Offline Database** - IndexedDB storage for channels, EPG, and VOD catalog

## Installation

Download the latest release for your platform from the [Releases](../../releases) page:

- **Windows**: `.exe` installer ✅ *tested*
- **macOS**: `.dmg`
- **Linux**: `.AppImage` or `.deb` (requires GStreamer runtime) - *untested, feedback welcome*

### Windows/macOS

mpv must be installed separately:

```bash
# macOS
brew install mpv

# Windows (Chocolatey)
choco install mpv
```

### Linux

> [!IMPORTANT]  
> On Linux, sbtlTV uses a small GStreamer helper that decodes to frames and renders them in the UI canvas. Wayland-native is not supported; the app forces X11/XWayland.

Runtime requirements (names vary by distro):

Ubuntu/Debian (required):
```bash
sudo apt install gstreamer1.0-plugins-base gstreamer1.0-plugins-good
```
Ubuntu/Debian (optional codecs / hw decode):
```bash
sudo apt install gstreamer1.0-plugins-bad gstreamer1.0-libav gstreamer1.0-plugins-ugly
```

Fedora (required):
```bash
sudo dnf install gstreamer1 gstreamer1-plugins-base gstreamer1-plugins-good
```
Fedora (optional codecs / hw decode):
```bash
sudo dnf install gstreamer1-plugins-bad-free gstreamer1-libav
```

Arch (required):
```bash
sudo pacman -S gstreamer gst-plugins-base gst-plugins-good
```
Arch (optional codecs / hw decode):
```bash
sudo pacman -S gst-plugins-bad gst-libav
```

Run in dev with `pnpm dev`. Wayland sessions require XWayland and the app forces `--ozone-platform=x11`.

## Building from Source

### Prerequisites

- Node.js 20+
- pnpm 10+
- mpv installed (for Windows/macOS development)

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
# Build for current platform
pnpm dist

# Build for specific platform
pnpm dist:win    # Windows
pnpm dist:mac    # macOS
pnpm dist:linux  # Linux
```

Output files will be in the `release/` directory.

### Linux Troubleshooting:

- Verify GStreamer plugins: `gst-inspect-1.0 playbin glimagesink`
- Increase GStreamer verbosity: `GST_DEBUG=3 pnpm dev`
- App log file + level (main + renderer):
  - `SBTLTV_LOG_FILE=/tmp/sbtltv-app.log SBTLTV_LOG_LEVEL=debug pnpm dev`
  - Full dev flags: `docs/DEV_ENV.md`

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
├── electron/    # Electron main process, playback integration
├── local-adapter/  # Local file adapter (future)
└── ui/          # React frontend (Vite)
```

## License

[GNU Affero General Public License v3.0](LICENSE)
