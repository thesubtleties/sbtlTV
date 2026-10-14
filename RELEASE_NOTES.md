# sbtlTV 0.12.0

## Added

- **Themes** - Settings > Appearance: sbtl, Catppuccin, Gruvbox, Nord, Tokyo Night, Mocha, Pi and more, Caelestia (follows the desktop on Linux), an optional system accent, and a choice of typeface.
- **Subtitles for movies and episodes** - the CC button (or V) turns them on; right-click for tracks and a subtitle delay, which is remembered per title.
- **Closed captions on live TV** - checked before they show, so station-data garbage stays off screen.
- **Caption language** - English, Spanish or French captions and subtitles, or follow the system.
- **Stream recovery** - provider cuts reconnect on their own, and a stalled stream is reloaded before you see an error.

## Changed

- **New look throughout** - Settings, guide, Movies and Series, title bar and overlays restyled to the theme.
- **Playback problems show in a card** with the actual cause and a Try again button.

## Fixed

- **A movie's resume point could be overwritten** when it was started after a live channel.
- **macOS: closing the window left the app unable to play** after reopening it from the Dock.
- **The guide's times did not line up** with the programmes below them.
- **Provider usernames and passwords no longer appear in the debug log.**
- **A link that fails to open now says so at once** with the compatibility player and on Windows.
- **Player controls did not respond after the window reloaded.**
- **Fewer harmless error messages**, now on macOS too.

## Known issues

- **Memory use can climb during in-window playback on macOS and Linux** - it mostly levels off and is released when you change channel or title. Still being watched.
- **Widescreen SD channels still play small on macOS.**
