# sbtlTV 0.17.0 beta 2

The second beta of 0.17.0. If you are on beta 1, this one arrived through the updater; if something feels off, save a bug report (Settings > Debug) and attach it to an issue.

## New in beta 2

- **A new app icon** - the sbtl logo on a dark glass tile, on every system. It reads on light and dark taskbars and Docks (the white logo alone nearly disappeared on a light Windows taskbar), and sits on the Mac's usual icon shape.
- **The Mac menu says sbtlTV** - About, Hide and Quit sbtlTV, instead of the package name.

## In 0.17.0 so far

### Added

- **Sync** - keep your watchlist, watch progress and favorite channels in step on your own computers, and, if you choose, look, subtitle and player settings. No account: Settings > Sync & transfer > Add a computer, type the code the other computer shows, check that both show the same three words. End-to-end encrypted through the sbtlTV relay, so even we can't read it. Titles match by TMDB and favorites by provider or guide id, so it works across different providers; what one computer doesn't have shows grayed, or hidden. Off until you turn it on.
- **Send a setup** - set up another computer, or someone else's, from yours with a short code and three matching words: providers (with or without logins), and settings and keys if you choose, including ones typed in just for that send. Deleted from the relay on pickup, or after 10 minutes.
- **First-run setup** - a fresh install walks through adding a source, a look, posters and details, and subtitles, or receives a setup from another computer.
- **What's new** - after an update, a short list of what changed, once.
- **More like this** - similar titles from your own library on every movie and series page (with a TMDB key). Opening one stacks: Back returns to the title before.
- **Movies & Series header** - Simple (text tabs) or Floating (a glass capsule, with a Genres panel), in Settings > Appearance. The home's art runs edge to edge under the bars, and they fill in as you scroll.
- **Full-bleed detail pages** - a movie or series page's backdrop runs up under the title bar, which clears over it and fills in as you scroll.
- **Loading screen** - from Play to the first frames: the title's art blurred, the sbtl letters, the title and episode. Cancel or Escape take you back. No more glimpse of the home on the way to the player.

### Improved

- **Scrollbars on Linux and Windows** are drawn over the page and shown while you scroll, as on macOS, so art reaches the window's edge.
- **The Genres panel fits shorter windows** (a MacBook Air's) without scrolling.
- **A failed play** brings back the page you pressed Play on, with the error and Try again. Before, the error could sit hidden under the Movies page, so nothing seemed to happen.

### Privacy

- The sbtlTV relay is contacted only while you send or receive a setup, or use Sync. It holds sealed data it can't open, refuses anything that isn't sealed, keeps no request logs and no backups. Settings > Privacy lists it with what it sees.

### Known issues

- **Sync and Send a setup need this version (or newer) on both computers.**
- **Going back to 0.16** resets the Movies & Series header to Simple.
- **Widescreen SD channels still play small on macOS.**
