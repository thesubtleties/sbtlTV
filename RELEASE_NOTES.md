# sbtlTV 0.13.0

Rewind live TV, a light palette, and the first release tested through betas.

## Added

- **Rewind live TV** - pause, rewind and catch back up to live. Off by default: Settings > Live TV > Live playback > Rewind live TV, with 512 MB, 2 GB, 8 GB or a custom amount of memory, up to a quarter of your RAM. Drag the playhead or use the arrow keys; End or the LIVE pill goes back to live, and ‹ › jump to the earlier or later show. Changing channel starts the rewind over.
- **sbtl light** - a light palette in Settings > Appearance: slate on a soft off-white, never stark white.
- **Beta updates** - Settings > About. Off by default; turn it on to try new versions early. A beta updates to newer betas, then to the full release they lead to.

## Changed

- **Settings are regrouped** into Content, Live TV, Movies & Series and System. Caption language, size and style now live in Video Player, which shows on every platform; the Live captions switch is in Live TV > Live playback.
- **Guide times have no leading zero** - 8:35, not 08:35.

## Fixed

- **Memory kept after playback** - the player held on to everything it had cached (about 100 MB per few minutes of live TV) until you quit. It is now released when you stop, or when you switch between live TV and movies or series.
- **Adding some Xtream sources failed** with "UNIQUE constraint failed: channels.stream_id" - providers that list a channel once in each of its categories now load.
- **An empty guide after a channel re-sync** - if the guide refresh after it failed, every channel showed no programmes until the next one worked.
- **The first poster in a Movies or Series list** had its hover glow cut off at the left edge.

## Known issues

- **Widescreen SD channels still play small on macOS.**
