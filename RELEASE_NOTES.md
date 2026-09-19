# sbtlTV 0.10.1

## Fixed

- **Large EPG downloads rejected** - compressed guides that inflate past 500MB were being refused on every sync since July, because the download was inflated in flight and measured after inflation. The guide is now saved as sent, decompressed on disk, and the limit is 4GB.
- **Unable to open the database after a failed EPG download** - a failed download raised a blocking error; quitting through it could leave the app unable to open its database on the next launch. Errors are now logged without stopping the app (regression in 0.10.0).
- **Channels wiped when a sync failed** - a channel sync cleared the previous list before fetching the new one, so a failed fetch left an empty guide. The old list now stays until the new one has arrived.
- **Movies stuck on a stale list** - a movie list that was cut off mid-download could be replayed from the app's HTTP cache for up to a week, so the Movies page failed to sync every time. Provider requests now bypass that cache.
- **Empty Movies and Series home** - if the lists failed to load while a large sync was running, the home stayed empty until you navigated away and back. It now retries.

## Improved

- **Guide speed on large channel lists** - the guide reads program data only for the rows on screen. Opening All Channels on a source with ten thousand channels no longer stalls.
- **Guide loading** - rows whose programs are still being read show placeholder blocks; when a row took a moment, its titles fade in and slide into place. The slide can be turned off under Settings > Channels > Loading.
- **Debug log** - the header records the exact build and each proxied request logs its response size.

See CHANGELOG.md for the full history.
