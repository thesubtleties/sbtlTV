# sbtlTV

A desktop IPTV player built with Electron and mpv.

<p align="center">
  <img src="https://storage.sbtl.dev/spookyspot/sbtltv.webp" alt="sbtlTV UI" width="720" />
</p>

> **Early Development** - This project is new and actively evolving. The goal is a dead-simple, low-latency player that balances aesthetics, ease of use, and quality-of-life features. We're constantly fixing bugs, adding features, and improving the experience. Check back often for updates, and feel free to [open an issue](../../issues) if you run into problems or have suggestions.

## Features

- **Live TV with EPG** - Browse channels by category with a full program guide
- **Movies & Series** - Netflix-style home page with hero section, carousels, and detail views
- **Multi-source with Priority** - Connect multiple Xtream sources; drag-and-drop to set priority for dedup and playback order
- **Cross-source Merging** - VOD deduplicates across sources; series gap-fill episodes from other providers
- **Watchlist & Favorites** - Save movies/series to a watchlist carousel; favorite channels for quick access
- **Watch Progress** - Resume playback where you left off; progress bars on cards and episodes; works across sources via TMDB matching
- **TMDB Integration** - Trending, popular, top-rated, and genre-based browsing; automatic offline metadata matching
- **Poster Overlays** - Optional rating badges on posters via RPDB
- **M3U Support** - Import local M3U playlists alongside Xtream sources
- **EPG from Multiple Sources** - Fetch guide data from your provider or external URLs
- **Channel Ordering** - Sort channels by provider numbers or alphabetically
- **Offline Storage** - Channels, EPG, and catalog cached locally for fast browsing

## Installation

Download the latest release from the [Releases](../../releases) page:

| Platform | Notes |
|----------|-------|
| Windows | mpv included |
| Linux | Requires mpv installed separately |
| macOS (Apple Silicon) | Video renders natively in-window; mpv via Homebrew recommended as fallback |

### Windows Users

Windows SmartScreen may block the app on first run. Click **More info** → **Run anyway** to proceed.

### macOS Users (Apple Silicon only)

Video renders natively inside the app window. No external mpv installation is required for normal use.

If the native renderer fails, the app falls back to system mpv. Install via Homebrew if needed:

```bash
brew install mpv
```

macOS builds are code-signed and notarized — the app should open without Gatekeeper warnings.

### Linux Users

mpv must be installed separately:

```bash
# Ubuntu/Debian
sudo apt install mpv

# Fedora
sudo dnf install mpv

# Arch
sudo pacman -S mpv
```

## Building from Source

### Prerequisites

- Node.js 20+
- pnpm 10+
- mpv installed

### Development

```bash
pnpm install
pnpm build
pnpm dev
```

### Building Distributables

```bash
# Download mpv for bundling (Windows)
bash scripts/download-mpv.sh

# Build for current platform
pnpm dist

# Platform-specific
pnpm dist:win
pnpm dist:mac
pnpm dist:linux
```

## Configuration

### Adding a Source

1. Open Settings (gear icon)
2. Go to Sources tab
3. Add your Xtream Codes credentials (server URL, username, password)
4. Click Sync to fetch channels and content

### TMDB Integration

Movie and series metadata comes from [The Movie Database](https://www.themoviedb.org/). Basic matching works automatically.

For genre browsing and suggested/popular lists, add a TMDB Access Token:
1. Create an account at [themoviedb.org](https://www.themoviedb.org/signup)
2. Get an API Read Access Token from [API settings](https://www.themoviedb.org/settings/api)
3. Add it in Settings → TMDB

*This product uses the TMDB API but is not endorsed or certified by TMDB.*

### Poster Overlays (RPDB)

Add rating badges to posters with an [RPDB](https://ratingposterdb.com/) API key in Settings → Poster DB.

### Debug Logging

Enable logging in Settings → Debug for troubleshooting. Logs are saved to your app data folder with automatic rotation.

### Data Location

- **Windows**: `%APPDATA%/sbtlTV`
- **macOS**: `~/Library/Application Support/sbtlTV`
- **Linux**: `~/.config/sbtlTV`

## Disclaimer

This application is a media player only and does not provide any content. Users must provide their own IPTV service credentials from a legitimate provider. The developers are not responsible for how this software is used or for any content accessed through it.

## Credits

Video playback powered by [mpv](https://mpv.io/).

## License

[GNU Affero General Public License v3.0](LICENSE)
