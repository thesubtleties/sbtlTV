# sbtlTV 0.14.0 beta 2

The second beta of 0.14.0. If you are on beta 1, this one arrived through the updater; if something feels off, save a bug report (Settings > Debug) and attach it to an issue.

## New in beta 2

- **Subtitles from SubDL** - Settings > Movies & Series > Subtitles. Add a free key from subdl.com and movies and episodes with no subtitles in your language get some. Right-click CC for Find subtitles (pick another file) and Sync subtitles (tap the line you just heard). Waits 10 s of playback before downloading (Off, 10, 20 or 30 s) so skipping through titles doesn't use your 50 downloads a day. SubDL sees the title, season, episode and language, nothing else.

## In 0.14.0 so far

### Added

- **Backup & transfer** - Settings > System. Export your setup (sources, logins, settings, API keys, favorites, watchlist) to one file locked with a five-word passphrase, and import it on another computer. sbtlTV backs up your setup before each import, so you can go back.
- **Bug report** - Settings > Debug. One zip with what's needed to look into a problem: versions, hardware, settings, how your sources are doing, and the log. No logins, provider addresses or names. Nothing is sent; you attach it to an issue.
- **Keyring (Linux)** - Settings > Privacy. sbtlTV keeps using the keyring your passwords were saved with, through updates and desktop changes. Switching restarts sbtlTV; saved passwords are entered again.

### Changed

- **Logs say less about you** - logins, provider addresses, source names and your user folder never appear, in more shapes than before (tokens, JSON, encoded links, IPv6).
- **Shorter settings text**, and every settings page has room at the bottom.

### Fixed

- **Linux: logins unreadable after an update** - the AppImage updater restarted without your `--password-store`, so saved passwords needed a manual restart.
- **The guide's clock and "on now" changed at different times** - they now change together, on the minute.
- **A failed read of sources or settings** showed an empty list or quiet defaults; it now says so.

## Known issues

- **A setup file from beta 2 with a SubDL key can't be imported in beta 1** - update first.
- **Widescreen SD channels still play small on macOS.**
