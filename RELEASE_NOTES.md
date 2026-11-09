# sbtlTV 0.16.0 beta 1

Hand-picked rows on the Movies and Series homes, smoother rows, and detail pages that open filled in. If something feels off, save a bug report (Settings > Debug) and attach it to an issue.

## Added

- **Selected lists** - themed rows on the Movies and Series homes, after Trending and Popular, marked with a feather. Picked by us, matched to your own library: only titles you have, in the list's order, and a row with fewer than 6 matches stays hidden. Adult titles are always left out.
- **Where the lists come from** - sbtlTV checks sbtltv.com for the list file at most once a day. The file is signed and checked against a key built into the app before anything is shown. The request carries no account or library details. Turn it off in Settings > Movies & Series > Selected lists: off means no request, and the saved copy is deleted.
- **Detail pages open filled in** - resting on a card for a moment loads what its page needs: details and backdrop from TMDB (with your TMDB key), and a series' episode list from your provider. Passing over a row loads nothing.
- **Episode lists stay current** - a series' list refreshes in the background when it is more than a day old, while the stored one shows. Before, a list was fetched once and never again.

## Improved

- **Rows scroll smoothly sideways** and can hold any number of titles (only the visible cards are drawn). Arrow keys move a focused row by most of its width.
- **One TMDB request per title** instead of two when a detail page opens.
- **A series opened for the first time says Loading episodes**, not "No episodes found", while the list arrives.

## Fixed

- **A refresh can't wipe a good episode list.** If your provider sends an empty list or doesn't answer, the stored list stays, with a small warning by the season picker naming the source, and a button to try again.

## Privacy

- Settings > Privacy lists sbtltv.com, and now says your provider, TMDB and (with RPDB backdrops on) RPDB also see the titles you point at, not just the ones you open.

## Known issues

- **Going back to 0.15 or earlier:** older versions can't read this version's data file, so they start a fresh one and sync again. Sources, settings, favorites and progress aren't in that file; playlists imported from a file are, and need importing again.
- **Widescreen SD channels still play small on macOS.**
