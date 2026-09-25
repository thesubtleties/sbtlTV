# sbtlTV 0.11.0

## Changed

- **Channel, guide and library data now live in a SQLite database managed by a background process** - syncing no longer runs inside the app window, so a large source cannot freeze the guide or black out the screen, and storing a 500,000-programme guide takes seconds instead of many minutes. Existing installs resync once on first launch. Watchlist, watch progress and favorites are unchanged.
- **Programmes are stored once per guide channel** - channels that share a guide channel (HD, FHD and backup variants) no longer duplicate its programmes.
- **Movie and series matching is incremental** - a library resync no longer re-runs TMDB matching for titles it already matched.

## Added

- **Linux player choice** - Settings > Security has a Video Player section on Linux that switches between the in-window player and the compatibility player (mpv in its own window, as before 0.10) for users whose GPU drops frames with the in-window pipeline. Takes effect on restart; a Restart button is offered.

## Improved

- **Playback keys** - the usual mpv keys now work while watching: Left/Right seek 5 seconds, Up/Down seek a minute, 9 and 0 change volume, P pauses like Space. Seeking applies to movies and episodes; the guide keeps Left/Right for its timeline.
- **Fullscreen on Linux** - F and F11 fullscreen the app window with the in-window player; only the compatibility player leaves fullscreen to its own mpv window.

## Fixed

- **Linux hardware decoding on AMD and Intel GPUs** - the in-window player never handed libmpv its DRM render node, so VA-API could not attach to the GPU and playback fell back to a copy path or software decoding. The render node is now passed at startup, and the debug log records the active decoder, codec and drop counters for each stream.
- **Linux DMA-BUF import on drivers without modifier support** - frame buffers were always described with format-modifier attributes, which some drivers reject outright. Linear buffers are now imported without them.

See CHANGELOG.md for the full history.
