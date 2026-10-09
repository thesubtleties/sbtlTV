# sbtlTV 0.11.1

## Changed

- **Linux player settings have their own page** - Settings > System > Video Player (moved from Security).

## Added

- **Performance mode on Linux** - lighter video scaling and no blur behind the controls, for machines whose in-window player drops frames.
- **mpv stats overlay on Linux** - press I to show decoder and dropped-frame statistics on the video, Shift+I to keep them on screen.

## Improved

- **Smoother in-window playback on Linux** - frames are shown on a steady clock instead of the moment they arrive, with audio kept in sync.
- **Less work while playing** - position updates no longer re-render the whole interface, which caused jitter on slower machines.

## Fixed

- **Movie and series library never synced for some providers** - one entry without a name no longer fails the whole sync.
- **A stall every two seconds in the in-window player on macOS and Linux.**
- **Widescreen SD channels played small on Linux.**
- **Play/pause button could show the wrong state** with the compatibility player and on Windows.
- **Ctrl, Alt and Cmd shortcuts also triggered player keys** (for example Ctrl+F toggled fullscreen).
- **Green frames with Intel hardware decoding on Linux.**
- **Black and dropped frames with NVIDIA on Linux.**
- **Red error banners for decoder errors that recover on their own (Linux).**
- **Settings controls that ignored the mouse on Linux.**
- **Restart in Compatibility Mode did nothing in the Linux AppImage.**
- **F and F11 only maximized the window on Linux** - they now enter real fullscreen.

## Known issues

- **Memory use grows during long in-window playback on macOS and Linux** - quitting and reopening sbtlTV frees it; a fix is planned.
- **Widescreen SD channels still play small on macOS.**
