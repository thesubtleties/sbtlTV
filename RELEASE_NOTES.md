# sbtlTV 0.10.0

## Added

- **Native Linux video playback** - on Linux, video now renders inside the app window through DMA-BUF shared textures instead of a separate floating mpv window. Works on X11 and Wayland with the system libmpv (libmpv 1 or 2 both supported; the .deb now declares the mpv dependency). If the native pipeline cannot start, the app offers a floating-window compatibility mode for that launch. Contributed by [aileks](https://github.com/aileks) (#94, #97).
- **Native playback recovery** - if the in-window video pipeline stops working mid-stream on macOS or Linux, a Reset Native Playback option rebuilds it in place (window size, volume and mute are preserved) instead of leaving a black screen. Contributed by [aileks](https://github.com/aileks) (#97).

## Fixed

- **macOS crash on some movies** - videos whose width is not a multiple of four (common for 2.39:1 rips at 1918 pixels wide) crashed the app as playback started.
- **EPG download crash** - a network failure in the middle of an EPG download could take the whole app down. Seen on Windows, possible on all platforms.

## Changed

- **Electron 44** - the app now runs on Electron 44. **macOS 13 (Ventura) or newer is required.** Macs on macOS 12 stay on 0.9.1 and are no longer offered updates. Contributed by [aileks](https://github.com/aileks) (#97).

See CHANGELOG.md for the full history.
