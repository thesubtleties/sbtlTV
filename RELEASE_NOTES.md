# sbtlTV 0.13.0 beta 1

The first beta. It leads to 0.13.0; if something feels off, send the Debug log (Settings > Debug) with your report.

## Added

- **Rewind live TV** - pause, rewind and catch back up to live. Off by default: Settings > Live TV > Live playback > Rewind live TV, from 512 MB to 8 GB of memory (capped at a quarter of your RAM). Drag the playhead or use the arrow keys; End or the LIVE pill goes back to live, and ‹ › jump to the earlier or later show.
- **sbtl light** - a light palette in Settings > Appearance: slate on a soft off-white, never stark white.
- **Beta updates** - Settings > About. Off by default; turn it on to get betas like this one.

## Changed

- **Settings are regrouped** into Content, Live TV, Movies & Series and System. Caption language, size and style now live in Video Player, which shows on every platform.

## Fixed

- **Memory kept after playback** - the player held on to everything it had cached (about 100 MB per few minutes of live TV) until you quit. It is now released when you stop, or when you switch between live TV and movies or series.
- **Re-syncing channels kept guide links** for channels that are still there.

## Known issues

- **Windows has not been tested with rewind** or with the new memory release yet - that is what this beta is for.
- **Widescreen SD channels still play small on macOS.**
