# sbtlTV 0.13.0 beta 2

The second beta of 0.13.0. If you are on beta 1, this one arrived through the updater; if something feels off, send the Debug log (Settings > Debug) with your report.

## New in beta 2

- **Guide times without a leading zero** - 8:35, not 08:35, like the rest of the app.
- **No Stop button flashing on a channel change** with rewind on; the LIVE pill stays put while the new channel starts.
- **The first poster in a Movies or Series list** no longer has its hover glow cut off at the left edge.

## In 0.13.0 so far

### Added

- **Rewind live TV** - pause, rewind and catch back up to live. Off by default: Settings > Live TV > Live playback > Rewind live TV, with 512 MB, 2 GB, 8 GB or a custom amount of memory, up to a quarter of your RAM. Drag the playhead or use the arrow keys; End or the LIVE pill goes back to live, and ‹ › jump to the earlier or later show.
- **sbtl light** - a light palette in Settings > Appearance: slate on a soft off-white, never stark white.
- **Beta updates** - Settings > About. Off by default; turn it on to get betas like this one. A beta updates to newer betas, then to the full release they lead to.

### Changed

- **Settings are regrouped** into Content, Live TV, Movies & Series and System. Caption language, size and style now live in Video Player, which shows on every platform; the Live captions switch is in Live TV > Live playback.

### Fixed

- **Memory kept after playback** - the player held on to everything it had cached (about 100 MB per few minutes of live TV) until you quit. It is now released when you stop, or when you switch between live TV and movies or series.
- **An empty guide after a channel re-sync** - if the guide refresh after it failed, every channel showed no programmes until the next one worked.

### Known issues

- **Windows has not been tested with rewind** or with the new memory release yet - that is what this beta is for.
- **Widescreen SD channels still play small on macOS.**
