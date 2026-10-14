# sbtlTV

[![Version](https://img.shields.io/github/v/release/thesubtleties/sbtlTV?style=for-the-badge&label=version&labelColor=0d0d0d&color=006a80)](https://github.com/thesubtleties/sbtlTV/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/thesubtleties/sbtlTV/total?style=for-the-badge&labelColor=0d0d0d&color=8b1a1a)](https://github.com/thesubtleties/sbtlTV/releases)
[![License](https://img.shields.io/github/license/thesubtleties/sbtlTV?style=for-the-badge&labelColor=0d0d0d&color=d9d9d9)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-2a2a2a?style=for-the-badge&labelColor=0d0d0d)](https://github.com/thesubtleties/sbtlTV/releases/latest)

A desktop IPTV player built with Electron and mpv.

<p align="center">
  <img src="https://storage.sbtl.dev/spookyspot/sbtltv-0.12.webp" alt="sbtlTV UI" width="720" />
</p>

sbtlTV aims to be a dead-simple, low-latency player that looks good and stays out of your way: quick channel changes, a real program guide, a proper Movies and Series library, and the small comforts that make IPTV feel like TV - resume where you left off, captions, themes, and streams that reconnect on their own. It is updated regularly; if you run into a problem or have an idea, [open an issue](../../issues).

## Features

- **Live TV with EPG** - Browse channels by category with a full program guide
- **Movies & Series** - Netflix-style home page with hero section, carousels, and detail views
- **Multi-source with Priority** - Connect multiple Xtream sources; drag-and-drop to set priority for dedup and playback order
- **Cross-source Merging** - VOD deduplicates across sources; series gap-fill episodes from other providers
- **Watchlist & Favorites** - Save movies/series to a watchlist carousel; favorite channels for quick access
- **Watch Progress** - Resume playback where you left off; progress bars on cards and episodes; works across sources via TMDB matching
- **Continue Watching** - Resume in-progress movies and episodes from a dedicated row on the Movies and Series homes, with autoplay-next-episode and an end-of-episode "Up Next" prompt
- **TMDB Integration** - Trending, popular, top-rated, and genre-based browsing; automatic offline metadata matching
- **Poster Overlays** - Optional rating badges on posters via RPDB
- **M3U Support** - Import local M3U playlists alongside Xtream sources
- **EPG from Multiple Sources** - Fetch guide data from your provider or external XMLTV URLs, with multi-strategy channel matching for third-party guides
- **Channel & Category Ordering** - Sort channels by provider number or alphabetically, and keep categories in your provider's original order (or A-Z)
- **Offline Storage** - Channels, EPG, and catalog cached locally for fast browsing
- **Subtitles & Live Captions** - Movie and episode subtitle tracks, and closed captions on live TV (checked for station-data junk before they show), in your language; size, style, and a per-title delay that is remembered
- **Themes** - sbtl plus Catppuccin, Gruvbox, Nord, Tokyo Night and more palettes, an optional system accent, and your choice of typeface
- **Stream Recovery** - Provider cuts reconnect on their own, and a stalled stream is reloaded where it was before you ever see an error

## Installation

Download the latest release from the [Releases](../../releases) page:

| Platform | Notes |
|----------|-------|
| Windows | mpv included |
| Linux | Video renders natively in-window; libmpv required (mpv binary used as fallback) |
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

Video renders natively inside the app window using the system libmpv. Install mpv with your package manager (it provides libmpv); the `mpv` binary is also used by the floating-window compatibility mode if the native pipeline is unavailable:

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

## Privacy

sbtlTV has no account and no server of its own, and sends no analytics, tracking or crash reports. Settings > Privacy shows how this applies on your computer.

**On your computer:** settings, watch history, favorites, watchlist, guide and library. Saved passwords and API keys are encrypted by your system (the macOS Keychain, Windows, or a Linux keyring such as KWallet or GNOME Keyring); on Linux without a keyring they are stored without strong encryption, and Settings > Privacy says so. The debug log is off by default; when on, it stays on your computer and links in it are cleaned of login details.

**Who sees what:** sbtlTV connects directly to these. Like a web browser, each request also says it comes from sbtlTV and which system you use.

| Who | When | What they see |
|-----|------|---------------|
| Your IPTV provider | Always | Your IP address, your account, and what you watch and when |
| Guide (EPG) sources | Always | Your IP address and when the guide refreshes (your provider's guide, plus any guide URLs you add) |
| Image hosts | Always | Your IP address and which images: channel logos and posters load from the addresses in your provider's data and from TMDB's image server |
| GitHub | Always | Two public data files, no account (the movie/series match file for library syncs, and TMDB's browse lists when you have no TMDB key), and update checks when sbtlTV starts (can be turned off): your IP address and sbtlTV version |
| TMDB | With your TMDB key | Your key, your IP address and the lists you browse. Without a key, only if GitHub's copy of the match file is unavailable: TMDB's public ID list, with your IP address |
| RatingPosterDB | With your RPDB key | Your key, your IP address and which titles' posters you see |
| ESPN | With team logos on (off by default on new installs) | Your IP address and which teams are playing on the channel you watch |
| Mullvad | When you click Check in Settings > Privacy | Your IP address, to show you the address the others see (nothing is saved) |

Your internet provider can see which of these sbtlTV connects to, and what you stream when a provider uses plain http. A VPN hides that from your internet provider, though not from the services above.

## Disclaimer

This application is a media player only and does not provide any content. Users must provide their own IPTV service credentials from a legitimate provider. The developers are not responsible for how this software is used or for any content accessed through it.

## Credits

Video playback powered by [mpv](https://mpv.io/).

## License

[GNU Affero General Public License v3.0](LICENSE)
