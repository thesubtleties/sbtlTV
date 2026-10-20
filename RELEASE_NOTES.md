# sbtlTV 0.14.0 beta 1

Leads to 0.14.0. Something off? Save a bug report (Settings > Debug) and attach it to an issue.

## Added

- **Backup & transfer** - Settings > System. Export your setup (sources, logins, settings, API keys, favorites, watchlist) to one file locked with a five-word passphrase, and import it on another computer. sbtlTV backs up your setup before each import, so you can go back.
- **Bug report** - Settings > Debug. One zip with what's needed to look into a problem: versions, hardware, settings, how your sources are doing, and the log. No logins, provider addresses or names. Nothing is sent; you attach it to an issue.
- **Keyring (Linux)** - Settings > Privacy. sbtlTV keeps using the keyring your passwords were saved with, through updates and desktop changes. Switching restarts sbtlTV; saved passwords are entered again.

## Changed

- **Logs say less about you** - logins, provider addresses, source names and your user folder never appear, in more shapes than before (tokens, JSON, encoded links, IPv6).
- **Shorter settings text**, and every settings page has room at the bottom.

## Fixed

- **Linux: logins unreadable after an update** - the AppImage updater restarted without your `--password-store`, so saved passwords needed a manual restart.
- **The guide's clock and "on now" changed at different times** - they now change together, on the minute.
- **A failed read of sources or settings** showed an empty list or quiet defaults; it now says so.

## Known issues

- **The keyring fix starts with the next update** - this beta has to be running first.
- **Widescreen SD channels still play small on macOS.**
