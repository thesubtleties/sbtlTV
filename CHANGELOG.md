# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-02-06

### Added
- Auto-updater: app checks for updates on launch and notifies when a new version is ready to install (NSIS installer only)
- Auto-update toggle in Settings → About to disable automatic update checks
- About tab with version display, manual update check button, and project links
- GitHub issues link in Debug settings tab
- Page slide animations and persisted navigation state for VOD browsing
- Randomized hero featured content on each app session

### Fixed
- TMDB title matching: strip provider language prefixes (e.g. "[EN]", "FR -") for more accurate metadata
- External links now open in system browser instead of Electron window
- Hero section no longer flickers when switching data sources
- About tab layout stabilized, hero token loading fixed
- Portable builds correctly skip auto-updater and show GitHub releases link

### Security
- Validate URL protocol in window open handler (https/http only)
- Block top-level navigation hijack via will-navigate handler
- Guard updater install with download verification flag
- Forward auto-updater errors to renderer for user visibility

### Changed
- Title bar darkened to match EPG guide panel opacity
- Extracted shared DetailHeader component for Movie/Series detail views
- Extracted useVodNavigation hook to reduce store branching duplication
- Extracted useVodPageAnimation hook from VodPage
- Replaced clipboard copy with external link for GitHub issues in Debug tab
- Moved AboutTab inline styles to CSS file
- Replaced magic timeout values with named constants
- Settings sidebar scrollbar now matches dark theme used elsewhere

### Known Issues
- Linux/macOS: Video plays in a separate window rather than embedded

## [0.2.2] - 2026-02-04

### Fixed
- Linux: Black screen with audio on certain configurations - now uses separate window mode for video playback
- Linux: Removed HDR flags that caused video rendering issues on some systems

### Changed
- Linux: Enabled verbose mpv logging for easier debugging of playback issues

### Known Issues
- Linux/macOS: Video plays in a separate window rather than embedded. Fully embedded playback works great on Windows, but Linux and macOS present non-trivial embedding challenges that are still being worked on.

## [0.2.1] - 2026-01-31

### Fixed
- macOS: Video not displaying due to bundled mpv issues - now prefers system mpv (`brew install mpv`) (needs testing)
- macOS: Added helpful error dialog with Homebrew install instructions when mpv not found
- Linux: Desktop icon not displaying - use properly sized 512x512 icon per freedesktop spec (needs testing)

## [0.2.0] - 2026-01-31

### Added
- Debug logging with file output and log rotation (Settings → Debug)
- Settings sidebar with organized tabs (General, Library, Debug)
- Clear all cached data button for troubleshooting
- Auto-hide UI controls and cursor during playback inactivity
- M3U EPG sync from external URLs (gzip supported)
- Web Worker for EPG parsing to prevent UI freezing on large files
- Channel number ordering - sort by provider's channel numbers (tvg-chno / Xtream num)
- Configurable staleness intervals for EPG and VOD auto-refresh

### Changed
- Settings UI reorganized into sidebar navigation
- XMLTV parser extracted to shared local-adapter module

## [0.1.0] - 2026-01-25

### Added
- Live TV browsing with category filtering
- EPG program guide display
- Movies browsing with TMDB metadata matching
- TV Series browsing with season/episode navigation
- mpv-based playback with hardware acceleration
- Multi-source support (Xtream Codes API)
- Stream URL fallback logic (.ts → .m3u8 → .m3u)
- Global sync status indicator
- Offline database (IndexedDB) for channels, EPG, and VOD
- Multi-platform builds (Windows, macOS, Linux)
- Bundled mpv for Windows and macOS
