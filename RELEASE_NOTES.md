# sbtlTV 0.15.0

Search the guide for shows, not just channels.

## Added

- **Guide search** - press / anywhere, or use the box in the guide. Find a show, game or team across all your channels: Channels, On now, Later, and Also mentions for shows that only match in their description. A show with several feeds or airings is one row, and it expands. Pick something on now to play it; pick something later and the guide jumps to it. Arrow keys, Enter and Esc all work.
- **Filter or search** - the button at the left of the box swaps back to filtering the open category by channel name, as before.
- **Leave adult categories out of search** - Settings > Live TV > Guide. Off by default. It goes by the provider's flag and category names, so some may get through.

## Fixed

- **The dot on the live bar shook back and forth** on channels with no guide data. At live it now stays at live.

## Known issues

- **Going back to 0.14 or earlier:** older versions can't read the updated guide data, and show an empty guide. Delete `sbtltv-data.sqlite` from the app's data folder and it rebuilds. Sources, settings, favorites and progress aren't in that file; playlists imported from a file are, and need importing again.
- **A setup file from this version can't be imported into 0.14.2 or earlier** - update first.
- **Widescreen SD channels still play small on macOS.**
