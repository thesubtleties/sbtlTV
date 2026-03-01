# Changelog

All notable changes to this project will be documented in this file.

## [0.6.0] - 2026-02-28

### Added
- **Source priority & organization** — reorder sources with drag-and-drop to set priority; priority determines which duplicate to show for both VOD and live TV
- **VOD dedup & cross-source merging** — duplicate movies/series across sources are merged; series combine episodes across sources to gap-fill missing seasons/episodes, each episode plays from most preferred source first
- **Movie source picker** — movie detail page lists all sources a movie is available on with buttons to play from any specific source; default playback uses preferred source
- **Channel favorites** — heart icon on channels with pulse animation and glassmorphism styling; favorite channels for quick access
- **VOD watchlist** — save movies and series to a persistent watchlist with a dedicated carousel on the home page
- **Watch progress tracking** — resume playback from where you left off; progress bars on movie cards, movie detail posters, and episode rows
- **Cross-source resume** — watch progress follows content across sources using TMDB ID matching (falls back to stream ID)
- **Episode watch progress** — per-episode progress bars and watched indicators (eye-shaped blur overlay) on series detail
- **Live TV category dedup** — categories with the same name across sources are grouped into a single entry
- **Category filter for live TV** — filter channels by category in the sidebar
- **Remember selected season** — series detail preserves your season selection through collapse/play cycles
- **Hero navigation redesign** — sliding frosted-glass pill indicator with spring physics, progress fill animation, and magnetic dot repulsion effect
- **Linux mpv keybindings** — external mpv window now supports default keybindings (f=fullscreen, m=mute, arrows=seek, space=pause)

### Fixed
- VOD performance regression — limited table scans, prevented double-queries, indexed category pruning
- Virtuoso infinite loop when rendering watchlist carousel
- Volume slider snapping to 100% when dragged to zero
- mpv resume reliability — generation counter prevents stale seeks, native seek for accuracy, null guards
- Purge orphaned data from deleted sources on startup
- Filter out stale data from deleted sources in queries
- node-gyp rebuild no longer nukes bundled dylibs during macOS packaging
- PriorityTab drag handler type safety
- Watchlist sort order — oldest first, newest last (matches user expectation)

### Changed
- **VOD hook architecture** — `useVod` split into `useVodCategories`, `useVodBrowse`, and `useVod` (single-item); deleted unused `useMovies`/`useSeries`
- **VodPage data extraction** — 88 lines of hook calls moved from VodPage into dedicated `useVodHomeData` hook
- `EpisodeRow` extracted as standalone component from SeriesDetail
- VOD categories use compound primary key `[source_id+category_id]` for multi-source support
- Adaptive category strip groups categories by name across sources
- Hero buttons upgraded with premium styling, Tabler icons, and subtle lift hover effect
- MediaCard hearts use glassmorphism with Tabler icons
- Play buttons use translucent white with backdrop blur
- Detail page buttons and watchlist icons refined
- macOS code signing and notarization added to CI workflow

## [0.5.3] - 2026-02-19

### Added
- macOS code signing and notarization — builds are now signed with Developer ID Application certificate and notarized via Apple, eliminating Gatekeeper warnings and enabling auto-update

### Changed
- Release workflow passes signing credentials to macOS build via GitHub Secrets
- Hardened runtime enabled with entitlements for native addon compatibility

## [0.5.2] - 2026-02-18

### Improved
- Media card hover effect — frosted glass play icon with smooth backdrop-filter transition (eliminates jank/pop)
- Play icon upgraded to Tabler player-play with rounded corners and semi-transparent frosted fill

### Refactored
- Extract shared `GenreCarouselTab` from MoviesTab/SeriesTab — eliminates ~260 lines of duplication
- Unify `matchMoviesWithTmdb`/`matchSeriesWithTmdb` into generic `matchWithTmdb<T>` — eliminates ~70 lines of duplication
- Extract shared `debugLog` utility with configurable category prefix
- Derive `supportsAutoUpdate` from sibling `isPortable`/`isLinuxNonAppImage` consts instead of recomputing from env
- Add `satisfies PlatformApi` type check to preload platform object (consistent with all other APIs)

## [0.5.1] - 2026-02-18

### Fixed
- macOS auto-updater — `quitAndInstall(false, true)` for reliable restart instead of silent failure
- About tab now shows full update lifecycle (checking → downloading with progress → restart button) instead of static "Update available" text
- Install errors are now visible to the user instead of silently swallowed
- Linux .deb builds correctly show "View Releases on GitHub" instead of broken auto-update UI
- Update notification toast stays visible on install failure instead of vanishing

### Changed
- Auto-updater state centralized in Zustand — single listener registration eliminates conflicts between About tab and update notification
- Added `supportsAutoUpdate` platform property so UI gating is derived in one place
- Renamed `isLinuxDeb` to `isLinuxNonAppImage` for accuracy (covers all non-AppImage Linux builds)

## [0.5.0] - 2026-02-17

### Added
- **Adjustable guide appearance** — category sidebar width and background opacity sliders in Settings → EPG

### Fixed
- macOS auto-updater now works — added zip build target required by electron-updater
- Release workflow uploads macOS zip to GitHub release assets
- Opacity stacking flicker — EPG panel uses positioning instead of padding when categories are visible, preventing double-layer opacity overlap during transitions

### Changed
- **Settings architecture** — all app settings consolidated into Zustand store, hydrated once at startup. Eliminates redundant IPC calls (previously each component independently fetched settings from disk). Settings changes are now reactive across the app.
- Settings tab renamed from "Channels" to "EPG" with new Guide Appearance section
- Settings content area is now scrollable with a styled scrollbar
- Sort order dropdown themed to match other settings controls

## [0.4.0] - 2026-02-15

### Added
- **Native in-window video on macOS** - Video now renders directly inside the app window using a native mpv-texture addon with GPU-accelerated IOSurface sharing (replaces external mpv window)
- Screen sleep prevention during video playback on all platforms
- macOS: `which mpv` PATH fallback for non-standard installs (MacPorts, Nix, custom prefix)

### Fixed
- Mutex lock ordering in native mpv context to prevent potential deadlock
- WebGL draw errors now logged with throttling and context loss detection
- Native texture bridge escalates to error callback after 5 consecutive frame failures
- Render thread fires error callback if GL context initialization fails
- IPC handlers wrapped in try-catch with debug logging
- Partial bridge destroyed on init failure (resource leak fix)
- Comment inaccuracies corrected across native addon
- Unified MpvStatus types across native bridge, preload, and UI layers
- Removed duplicate dependency and redundant addon import

### Changed
- macOS builds are now **arm64 (Apple Silicon) only** — Intel Mac support discontinued
- macOS no longer bundles an external mpv binary — uses native addon with system mpv as fallback
- CI workflows updated for native addon build pipeline (brew + node-gyp + dylib bundling)

### Known Issues
- Linux: Video plays in a separate window rather than embedded

## [0.3.1] - 2026-02-07

### Fixed
- "Check for Updates" no longer falsely shows "Update available" when already on the latest version
- CI: build pipeline no longer fails on GitHub release creation

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
