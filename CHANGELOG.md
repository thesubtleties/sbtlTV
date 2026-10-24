# Changelog

All notable changes to this project will be documented in this file.

## [0.14.0] - 2026-10-24

Subtitles from SubDL, moving your setup to another computer, and bug reports that leave you out.

### Added
- **Subtitles from SubDL** - Settings > Movies & Series > Subtitles. Add a free key from subdl.com and movies and episodes with no subtitles in your language get some. Right-click CC for Find subtitles (pick another file) and Sync subtitles (tap the line you just heard). Waits 10 s of playback before downloading (Off, 10, 20 or 30 s) so skipping through titles doesn't use your 50 downloads a day. SubDL sees the title, season, episode and language, nothing else
- **Backup & transfer** - Settings > System. Export your setup (sources, logins, settings, API keys, favorites, watchlist) to one file locked with a five-word passphrase, and import it on another computer. sbtlTV backs up your setup before each import, so you can go back. Not in the Windows portable version
- **Bug report** - Settings > Debug. One zip with what's needed to look into a problem: versions, hardware, settings, how your sources are doing, and the log. No logins, provider addresses or names. Nothing is sent; you attach it to an issue
- **Keyring (Linux)** - Settings > Privacy. sbtlTV keeps using the keyring your passwords were saved with, through updates and desktop changes. Switching restarts sbtlTV; saved passwords are entered again

### Changed
- **Logs say less about you** - logins, provider addresses, source names and your user folder never appear, in more shapes than before (tokens, JSON, encoded links, IPv6)
- **Shorter settings text**, and every settings page has room at the bottom

### Fixed
- **Linux: logins unreadable after an update** - the AppImage updater restarted without your `--password-store`, so saved passwords needed a manual restart
- **The guide's clock and "on now" changed at different times** - they now change together, on the minute
- **A failed read of sources or settings** showed an empty list or quiet defaults; it now says so

### Known issues
- **Widescreen SD channels still play small on macOS**

## [0.13.0] - 2026-10-17

Rewind live TV, a light palette, and the first release tested through betas.

### Added
- **Rewind live TV** - pause, rewind and catch back up to live. Off by default: Settings > Live TV > Live playback > Rewind live TV, with 512 MB, 2 GB, 8 GB or a custom amount of memory, up to a quarter of your RAM. The player bar shows how far back you can go, with a LIVE pill (or how far behind live you are); drag the playhead or use the arrow keys, End or the pill goes back to live, and the buttons at either end jump to the earlier or later show. The title follows the show you are watching. A size change applies from the next channel, and changing channel starts the rewind over
- **sbtl light** - a light palette in Settings > Appearance: slate on a soft off-white, never stark white, light all the way through, including the guide and player bar over video
- **Beta updates** - Settings > About. Off by default; turn it on to try new versions early. A beta updates to newer betas, then to the full release they lead to

### Changed
- **Settings are regrouped** into Content, Live TV (Guide, Live playback), Movies & Series (Movies, Series, Subtitles, TMDB, Poster DB) and System. Caption language, size and style live in Video Player, which now shows on every platform; the Live captions switch is in Live TV > Live playback
- **Guide times have no leading zero** - 8:35, not 08:35, like the rest of the app

### Fixed
- **Memory kept after playback** - the player held on to everything it had cached (about 100 MB per few minutes of live TV) until you quit. It is now released when you stop, or when you switch between live TV and movies or series
- **Adding some Xtream sources failed** with "UNIQUE constraint failed: channels.stream_id" - providers that list a channel once in each of its categories now load, with the channel in every one of those categories (#133)
- **An empty guide after a channel re-sync** - if the guide refresh after it failed, every channel showed no programmes until the next one worked (#90)
- **The first poster in a Movies or Series list** had its hover glow cut off at the left edge

### Known issues
- **Widescreen SD channels still play small on macOS**

## [0.12.1] - 2026-10-14

A privacy release.

### Added
- **Settings > Privacy** - what stays on your computer (including whether saved passwords and API keys are encrypted by your system), a Check button that shows the IP address outside services see, and who sbtlTV talks to and what each one sees, marked by whether it applies to you right now. The check asks Mullvad's public checker, only when clicked, and nothing is saved
- **Privacy section in the README** with the same information

### Changed
- **Team logos on live games are off by default on new installs** - the logos load from ESPN, which then sees your IP address and which teams you are watching. Existing installs keep them as they were (on, unless you turned them off). Settings > EPG > Team logos now says where they come from

### Improved
- **Team logos** sit apart with "@" or "vs" between them, as the listing has it, instead of overlapping
- **More games are recognized** - guide listings with a generic title ("College Football", "NFL Football") and the game in the description ("The Nevada Wolf Pack visit the UTEP Miners...", "The Broncos face the Seahawks...", "Raptors at Knicks from Madison Square Garden") now show the teams' logos too

### Fixed
- **A request to Google on first launch (Windows and Linux)** - Chromium downloaded a spell-check dictionary from Google. Spell checking is now off and nothing is fetched
- **Login details in terminal and system log output** - 0.12.0 cleaned them from the debug log and error messages; links are now also cut to their host in what the player prints to a terminal or the system log, login values and Xtream paths are cleaned even when they are not part of a full link, and output split across chunks is cleaned as whole lines. The interface's debug messages are no longer printed to the console outside development builds
- **A provider's unreadable reply could put login details in an error message** - the start of the reply is still shown to help diagnose it, with login values removed

### Known issues
- **Memory use can climb during in-window playback (macOS and Linux)** - it mostly levels off and is released when you change channel or title. Still being watched
- **Widescreen SD channels still play small on macOS**

## [0.12.0] - 2026-10-14

### Added
- **Themes** - Settings > Appearance has palette tiles: sbtl (the default), Catppuccin, Gruvbox, Nord, Tokyo Night, Mocha, Pi and more, plus Caelestia, which follows the desktop's colors on Linux. The accent can follow the system's, and the typeface is selectable (Fira Sans, now bundled, JetBrains Mono or the system font)
- **Subtitles for movies and episodes** - the file's own subtitle tracks, drawn by mpv in both players. The CC button in the player bar (or V) turns them on and off; right-click it for the track list and a subtitle delay (Z and X nudge it). A delay set for a movie or episode is saved with its watch progress and restored the next time it plays
- **Closed captions on live TV** - the captions broadcast with US channels (EIA-608). mpv's caption decoder picks one of the two caption fields at random each time it starts, and on most channels the other field carries station data that shows as garbage ("HEHEHE", "H@ABC Network"). Captions now stay hidden until their first lines read as real text; on junk the decoder is restarted (the channel keeps playing), and a channel whose captions never come through says so on the CC button
- **Caption language** - Settings > Subtitles > Language (Auto, English, Espanol, Francais). Many channels carry English on one caption field and Spanish on the other; live captions settle on the language chosen, showing the other one only if nothing else comes through within 30 seconds, and a movie's subtitles pick that language's track
- **Settings > Subtitles** - on by default for live TV and for movies and series separately, size and style (outline, box or shadow)
- **Stream recovery** - when a provider cuts a stream, it reconnects on its own. A stream that stops moving for 15 seconds without being paused is reloaded (movies at their position), up to three times with a quiet "Reconnecting" note, then a single message. Pausing, system sleep, a movie reaching its end and a slow-opening movie are not mistaken for a stall

### Changed
- **New look throughout** - Settings, the guide, Movies and Series, cards, the hero, the title bar and the overlays were restyled to the theme, with firmer corners and line icons
- **Playback problems show in a card under the title bar** instead of a full-width red strip. It shows the first error mpv reported (usually the cause, such as an HTTP error), with Try again to play the same channel or movie again
- **A link that does not open shows its error once** instead of the error being followed by reconnect attempts

### Fixed
- **A movie's resume point could be overwritten when it was started after a live channel** - the previous stream's position and duration were briefly taken for the movie's and saved as its progress. They are now held back until mpv has switched files, and progress is saved only once the resume seek has landed
- **Closing the window on macOS left the app unable to play** - reopening it from the Dock gave "mpv not initialized". The player now starts again with the window
- **The guide's times were 32px left of the programmes they mark**
- **Provider usernames and passwords in the debug log** - stream URLs (which carry them for Xtream sources) are cut to their host in the log and in error messages
- **A failed open showed nothing with the compatibility player and on Windows** until the stream timed out; it now shows its error at once
- **No error for an MP4 that lists a chapter track it does not contain**, or for the half picture at the start of a live stream joined mid-picture; the harmless-message filter now applies on macOS too
- **Player controls did not respond after the window reloaded** - a reloaded window waited for a ready signal that is only sent once
- **Movies and Series rows** - the space after the last card matches the space before the first, and the rows' scrollbar no longer shifts them off-centre

### Known issues
- **Memory use can climb during in-window playback (macOS and Linux)** - it mostly levels off and is released when you change channel or title; earlier notes overstated it. Still being watched
- **Widescreen SD channels still play small on macOS**

## [0.11.1] - 2026-10-09

### Changed
- **Linux player settings have their own page** - the in-window/compatibility player choice moved from Security to Settings > System > Video Player (Linux only). Its Restart button is replaced by a note to quit and reopen sbtlTV

### Added
- **Performance mode on Linux** - Settings > System > Video Player has a Performance mode checkbox for machines whose in-window player drops frames. It uses mpv's cheap scaling options (the "fast" profile) and removes the blur behind the guide and controls, which is recomputed for every video frame. The blur change is immediate; the video settings apply after quitting and reopening
- **mpv stats overlay on Linux** - with the in-window player, I shows mpv's statistics (decoder, hwdec, dropped frames) on the video for a few seconds and Shift+I keeps them on screen

### Improved
- **Smoother in-window playback on Linux** - frames reach the window unevenly on slower machines, and drawing each one the moment it arrived showed every late frame as a hitch. The in-window player now keeps about three frames queued and shows them on a steady clock (roughly 120ms behind at 25 fps, less at 50 or 60 fps). Audio is delayed by the same amount, measured once per stream, so lip sync is unchanged
- **Less work on the interface thread while playing** - every position update from mpv re-rendered the whole interface, including the hidden guide. On a slower Linux machine that kept the thread that also draws the video busy for 25-40ms several times a second, which showed as constant jitter. The playback position now updates only the now-playing bar, and the hidden guide no longer re-renders
- **Fewer status messages from the in-window player on macOS and Linux** - mpv reports the position on every frame; it now reaches the interface at most 10 times per second, as with the compatibility player. Play, pause, mute, volume and stream changes are still immediate

### Fixed
- **A stall every two seconds in the in-window player on macOS and Linux** - the 0.11.0 decode diagnostics read four mpv properties synchronously from the app's main thread every two seconds, and that read can wait on the player's render loop (a 150ms hitch and a dropped frame per tick on the Linux tester's machine). On Linux the values now arrive through mpv's change notifications; on macOS they are only read while debug logging is on
- **Widescreen SD channels played small with black bars on every side on Linux** - anamorphic streams (720x576 pixels shown at 16:9 or 16:11) were rendered at their pixel size, so the picture was letterboxed twice. The render target now uses the display size, and a size change that arrives while the player is resizing is no longer lost
- **Movie and series library never synced for some providers** - one entry the provider sent without a name failed the whole sync, which retried every few minutes and failed again, leaving Movies and Series empty. Nameless entries are now stored (with their title where there is one) and the rest of the library syncs
- **Play/pause button could show the wrong state with the compatibility player and on Windows** - status updates arriving within 100ms of the previous one were dropped, including pause, mute and volume changes, so the button and controls could stay out of date until the next update. The latest update is now always delivered
- **Ctrl, Alt and Cmd shortcuts also triggered player keys** - Ctrl+F toggled fullscreen, Ctrl+P paused and Cmd+M also muted. Player keys now ignore those combinations (Shift+I is unchanged)
- **Green frames with Intel hardware decoding on Linux** - libmpv's VA-API interop was given the same DRM file descriptor Mesa uses for the in-window renderer, so buffer handles clashed and decoded surfaces were destroyed underneath the decoder, with a fallback to a copy path. VA-API now gets its own descriptor, as mpv's and Kodi's DRM outputs do
- **Black and dropped frames with NVIDIA on Linux** - NVIDIA's driver does not make Chromium wait for mpv to finish drawing a shared video buffer, so a frame could be shown mid-draw. On NVIDIA each frame is now finished before it is handed over (`SBTLTV_MPV_GL_FINISH=1` forces this on any GPU)
- **Red error banners for recoverable decoder errors on Linux** - hardware decoder probing and the broken first pictures of a live stream ("non-existing PPS referenced", "co located POCs unavailable", "Could not dynamically load CUDA") recover on their own and now go to the debug log only. Other video errors, such as a decoder that cannot open, still show
- **Settings controls that ignored the mouse on Linux** - the player options shared a page with Network Security, and the two sections were squeezed into the panel height and drawn over each other, so clicks landed on the wrong one. Settings pages with several sections now scroll instead of overlapping
- **Restart in Compatibility Mode did nothing in the Linux AppImage** - the restart relaunched a path inside the AppImage mount, which is gone by the time the new process starts. It now relaunches the AppImage itself
- **Fullscreen on Linux** - 0.11.0 listed F and F11 as fullscreening the window, but with the in-window player they only maximized it. They now enter real fullscreen; the compatibility player is unchanged

### Known issues
- **Memory use grows during in-window playback (macOS and Linux)** - Electron's per-frame shared-texture hand-off leaks native memory in the main process, roughly 1.5-3 GB per hour at 60 fps. Present since the in-window player arrived; quitting and reopening sbtlTV frees it. A rework of the frame hand-off is planned
- **Widescreen SD channels still play small on macOS** - the fix above is enabled on Linux only for now

## [0.11.0] - 2026-09-25

### Changed
- **Channel, guide and library data now live in a SQLite database managed by a background process** - syncing no longer runs inside the app window, so a large source cannot freeze the guide or black out the screen, and storing a 500,000-programme guide takes seconds instead of many minutes. Existing installs resync once on first launch. Watchlist, watch progress and favorites are unchanged
- **Programmes are stored once per guide channel** - channels that share a guide channel (HD, FHD and backup variants) no longer duplicate its programmes
- **Movie and series matching is incremental** - a library resync no longer re-runs TMDB matching for titles it already matched

### Added
- **Linux player choice** - Settings > Security has a Video Player section on Linux that switches between the in-window player and the compatibility player (mpv in its own window, as before 0.10) for users whose GPU drops frames with the in-window pipeline. Takes effect on restart; a Restart button is offered

### Improved
- **Playback keys** - the usual mpv keys now work while watching: Left/Right seek 5 seconds, Up/Down seek a minute, 9 and 0 change volume, P pauses like Space. Seeking applies to movies and episodes; the guide keeps Left/Right for its timeline
- **Fullscreen on Linux** - F and F11 fullscreen the app window with the in-window player; only the compatibility player leaves fullscreen to its own mpv window

### Fixed
- **Linux hardware decoding on AMD and Intel GPUs** - the in-window player never handed libmpv its DRM render node, so VA-API could not attach to the GPU and playback fell back to a copy path or software decoding, dropping frames on anything but NVIDIA. The render node is now passed at startup, and the debug log records the active decoder (`hwdec-current`), codec and mpv's own drop counters for each stream
- **Linux DMA-BUF import on drivers without modifier support** - frame buffers were always described with format-modifier attributes, which drivers lacking `EGL_EXT_image_dma_buf_import_modifiers` reject outright. Linear buffers are now imported without them

## [0.10.1] - 2026-09-19

### Fixed
- **Large EPG downloads rejected** - compressed guides that inflate past 500MB (a 312MB .gz that expands to 3GB, for example) were being refused on every sync since July, because the download was inflated in flight and measured after inflation. The guide is now saved as sent, decompressed on disk, and the limit is 4GB
- **Unable to open the database after a failed EPG download** - a failed download raised a blocking error in the main process; quitting through it could leave the app unable to open its database on the next launch. Errors are now logged without stopping the app (regression in 0.10.0)
- **Channels wiped when a sync failed** - a channel sync cleared the previous list before fetching the new one, so a failed fetch left an empty guide. The fetch now completes first and the old list stays until it does
- **Movies stuck on a stale list** - a movie list that was cut off mid-download could be replayed from the app's HTTP cache for up to a week, so the Movies page failed to sync every time. Provider requests now bypass that cache, and an empty or unreadable response is retried once and reported with what came back
- **Empty Movies and Series home** - if the lists failed to load while a large sync was running, the home stayed empty until you navigated away and back. It now retries

### Improved
- **Guide speed on large channel lists** - the guide reads program data only for the rows on screen instead of every channel in the list. Opening All Channels on a source with ten thousand channels no longer stalls
- **Guide loading** - rows whose programs are still being read show placeholder blocks; when a row took a moment, its titles fade in and slide into place. The slide can be turned off under Settings > Channels > Loading
- **Debug log** - the header records the exact build, and each proxied request logs its response size, so a truncated provider response can be told apart from a network problem

## [0.10.0] - 2026-09-13

### Added
- **Native Linux video playback** - on Linux, video now renders inside the app window through DMA-BUF shared textures instead of a separate floating mpv window. Works on X11 and Wayland with the system libmpv (libmpv 1 or 2 both supported; the .deb now declares the mpv dependency). If the native pipeline cannot start, the app offers a floating-window compatibility mode for that launch. Contributed by @aileks (#94, #97)
- **Native playback recovery** - if the in-window video pipeline stops working mid-stream on macOS or Linux, a Reset Native Playback option rebuilds it in place (window size, volume and mute are preserved) instead of leaving a black screen. Contributed by @aileks (#97)

### Fixed
- **macOS crash on some movies** - videos whose width is not a multiple of four (common for 2.39:1 rips at 1918 pixels wide) crashed the app as playback started. The shared video surface was created with an unaligned row pitch
- **EPG download crash** - a network failure in the middle of an EPG download could take the whole app down ("Cannot call write after a stream was destroyed"). Seen on Windows, possible on all platforms

### Changed
- **Electron 44** - the app now runs on Electron 44. macOS 13 (Ventura) or newer is required; Macs on macOS 12 stay on 0.9.1 and are no longer offered updates. Contributed by @aileks (#97)

## [0.9.1] - 2026-07-24

### Fixed
- **EPG for duplicate channel variants** - when a provider lists the same channel several times (HD, FHD, HEVC, backup), every variant now shows its guide data instead of only one of them. Applies on the next EPG refresh; if your EPG refresh is set to Manual only, use Sync Now to pick it up. Reported and prototyped by @JiggsNephron (#87, #88)

## [0.9.0] - 2026-06-27

### Added
- **Channel search** - filter the channel list by name from a search box in the guide header, per category. Contributed by @Herbrax (#82)
- **Resizable channel column** - a Channel Column Width control under Settings > Guide Appearance sizes the channel-info column to taste; it yields on very narrow windows so the program grid stays usable
- **Channel-name tooltip** - hover a long, truncated channel name to see it in full

### Fixed
- **VOD home hover** - hovering a cover on the Movies and Series home no longer clips the top of the artwork as it zooms

## [0.8.2] - 2026-06-08

### Fixed
- **Update notification button** - the "Restart" and "Later" buttons on the in-app update notification are clickable again. They had become unresponsive when the update chip was folded into the toast stack (the container disabled pointer events without re-enabling them on the chip). Updating from Settings was unaffected

## [0.8.1] - 2026-06-08

### Fixed
- **Windows fullscreen** - f / F11 / the player button now cover the whole screen (taskbar included) and exit cleanly via Esc / f / F11 / the title-bar control. Previously they only maximized the window, leaving the taskbar visible (#76)

## [0.8.0] - 2026-06-03

### Added
- **Continue Watching** - resume movies and episodes from a Continue Watching row on the Movies and Series homes; next-episode autoplay with an end-of-episode "Up Next" prompt, a manual Next button in the player, and a setting; watch-progress indicators on episodes; remove-from-row action (#66, #67, #68)
- **Live sports matchup logos** - a conservative EPG-title matcher resolves "Team A at Team B" against a bundled ESPN team directory and shows both teams' logos in the Now Playing bar; settings toggle (default on); falls back to the EPG description, then the channel icon
- **Fullscreen mode** - f / F11 / player-button toggle with Esc to exit; the title bar stays reachable (its maximize button becomes an exit-fullscreen control). Platform split: true fullscreen on macOS, maximize on Windows/Linux
- **Scroll-to-top** - re-clicking the active category returns its channel list or VOD grid to the top
- **Toast notifications** - reusable toast system with a branded loader, wired to remove-source progress, add-source success, and initial-sync failures (#11, #71)
- **Provider category order** - new "Category Order: Alphabetical | Provider" setting for live TV; Provider mode keeps your source's original category arrangement, with auto-resync to backfill order on enable (#48)

## [0.7.0] - 2026-04-13

### Added
- **EPG channel matching with external EPG sources** — 12-strategy matcher (exact ID through fuzzy word-overlap) enables external EPG sources like epg.pw to work alongside provider EPGs
- **Streaming XMLTV parser** — indexOf-based parser in a worker thread handles multi-GB EPG files with constant memory; two-phase parsing skips ~90% of data by filtering unmatched programmes
- **Persistent EPG mappings** — Dexie v12 `epgMappings` table stores channel-to-EPG matches with confidence levels and strategy info, surviving across syncs
- **Filtered EPG parsing** — only processes programmes for matched channels, dramatically reducing parse time and memory for large EPG files
- **Call sign extraction** — matches US/Canadian local stations by extracting call signs from channel names (WABC, KGUN, etc.) with DT suffix handling

### Fixed
- EPG programme IDs now include source ID to prevent cross-source collisions for Xtream users with multiple sources
- Single-quoted XML attributes in XMLTV files now parsed correctly (previously silently dropped)
- Hex XML entity references (`&#x2019;`) now decoded properly
- `slugify` now strips all parenthesized groups, not just the first
- `normalizeLooser` no longer mangles channel acronyms (MTV, CTV, ATV)

### Improved
- Worker thread errors now propagate meaningful messages instead of generic "exited with code 1"
- EPG sync errors return structured results with error details for debug logging
- Temp file cleanup on all error paths (download failure, decompress failure, parse failure)
- Download size limit (500MB) and decompression bomb guard (4GB) prevent disk exhaustion
- 8-minute timeout on EPG worker thread prevents indefinite hangs
- Web worker circuit breaker stops crash-recreate loops after 3 consecutive failures
- SSRF blocklist expanded with `0.0.0.0` and IPv4-mapped IPv6 patterns
- Worker diagnostic logs now route through main process debug logger (visible in production)
- Failed EPG URLs tracked and reported in multi-URL configurations

## [0.6.3] - 2026-03-15

### Fixed
- macOS auto-update failing silently — Squirrel.Mac's ShipIt couldn't remove quarantine xattr from a read-only `libmpv.dylib` in the asar-unpacked directory; fixed dylib permissions and excluded build-time deps from packaging
- macOS playback resilience — WebGL context recovery after GPU reset, pause/resume on sleep/wake to prevent GPU pipeline errors, stale frame clearing on channel switch
- VOD sync failures now logged to debug file (previously console-only), making issues diagnosable from exported logs
- VOD sync no longer overwrites existing movie/series counts when a fetch fails — preserves previous good data
- VOD sync timestamp only updates when at least one content type actually synced, preventing failed syncs from suppressing retries
- Xtream API responses validated as arrays before processing — prevents silent crash on non-standard server responses
- LAN blocked error message now correctly says "Settings > System > Security" matching actual UI navigation

## [0.6.2] - 2026-03-11

### Fixed
- M3U channels duplicated into custom groups (e.g. via IPTVEditor) now appear in all assigned categories instead of only the last one

## [0.6.1] - 2026-03-01

### Fixed
- macOS auto-update not applying — bundled dylibs had read-only permissions (644) which caused Squirrel.Mac's ShipIt to fail with "Permission denied" when replacing the app bundle; changed to 755

## [0.6.0] - 2026-02-28

### Added
- **Source priority & organization** — reorder sources with drag-and-drop to set priority; priority determines which duplicate to show for both VOD and live TV
- **VOD dedup & cross-source merging** — duplicate movies/series across sources are merged; series combine episodes across sources to gap-fill missing seasons/episodes, each episode plays from most preferred source first
- **Movie source picker** — movie detail page lists all sources a movie is available on with buttons to play from any specific source; default playback uses preferred source
- **Channel favorites** — heart icon on channels with pulse animation and glassmorphism styling; favorite channels for quick access
- **VOD watchlist** — save movies and series to a persistent watchlist with a dedicated carousel on the home page
- **Watch progress tracking** — resume playback from where you left off; progress bars on movie cards, movie detail posters, and episode rows
- **Cross-source resume** — watch progress follows content across sources using TMDB ID matching (falls back to stream ID)
- **Episode watch progress** — per-episode progress bars and watched indicators (eye-shaped blur overlay) on series detail
- **Live TV category dedup** — categories with the same name across sources are grouped into a single entry
- **Category filter for live TV** — filter channels by category in the sidebar
- **Remember selected season** — series detail preserves your season selection through collapse/play cycles
- **Hero navigation redesign** — sliding frosted-glass pill indicator with spring physics, progress fill animation, and magnetic dot repulsion effect
- **Linux mpv keybindings** — external mpv window now supports default keybindings (f=fullscreen, m=mute, arrows=seek, space=pause)

### Fixed
- VOD performance regression — limited table scans, prevented double-queries, indexed category pruning
- Virtuoso infinite loop when rendering watchlist carousel
- Volume slider snapping to 100% when dragged to zero
- mpv resume reliability — generation counter prevents stale seeks, native seek for accuracy, null guards
- Purge orphaned data from deleted sources on startup
- Filter out stale data from deleted sources in queries
- node-gyp rebuild no longer nukes bundled dylibs during macOS packaging
- PriorityTab drag handler type safety
- Watchlist sort order — oldest first, newest last (matches user expectation)

### Changed
- **VOD hook architecture** — `useVod` split into `useVodCategories`, `useVodBrowse`, and `useVod` (single-item); deleted unused `useMovies`/`useSeries`
- **VodPage data extraction** — 88 lines of hook calls moved from VodPage into dedicated `useVodHomeData` hook
- `EpisodeRow` extracted as standalone component from SeriesDetail
- VOD categories use compound primary key `[source_id+category_id]` for multi-source support
- Adaptive category strip groups categories by name across sources
- Hero buttons upgraded with premium styling, Tabler icons, and subtle lift hover effect
- MediaCard hearts use glassmorphism with Tabler icons
- Play buttons use translucent white with backdrop blur
- Detail page buttons and watchlist icons refined
- macOS code signing and notarization added to CI workflow

## [0.5.3] - 2026-02-19

### Added
- macOS code signing and notarization — builds are now signed with Developer ID Application certificate and notarized via Apple, eliminating Gatekeeper warnings and enabling auto-update

### Changed
- Release workflow passes signing credentials to macOS build via GitHub Secrets
- Hardened runtime enabled with entitlements for native addon compatibility

## [0.5.2] - 2026-02-18

### Improved
- Media card hover effect — frosted glass play icon with smooth backdrop-filter transition (eliminates jank/pop)
- Play icon upgraded to Tabler player-play with rounded corners and semi-transparent frosted fill

### Refactored
- Extract shared `GenreCarouselTab` from MoviesTab/SeriesTab — eliminates ~260 lines of duplication
- Unify `matchMoviesWithTmdb`/`matchSeriesWithTmdb` into generic `matchWithTmdb<T>` — eliminates ~70 lines of duplication
- Extract shared `debugLog` utility with configurable category prefix
- Derive `supportsAutoUpdate` from sibling `isPortable`/`isLinuxNonAppImage` consts instead of recomputing from env
- Add `satisfies PlatformApi` type check to preload platform object (consistent with all other APIs)

## [0.5.1] - 2026-02-18

### Fixed
- macOS auto-updater — `quitAndInstall(false, true)` for reliable restart instead of silent failure
- About tab now shows full update lifecycle (checking → downloading with progress → restart button) instead of static "Update available" text
- Install errors are now visible to the user instead of silently swallowed
- Linux .deb builds correctly show "View Releases on GitHub" instead of broken auto-update UI
- Update notification toast stays visible on install failure instead of vanishing

### Changed
- Auto-updater state centralized in Zustand — single listener registration eliminates conflicts between About tab and update notification
- Added `supportsAutoUpdate` platform property so UI gating is derived in one place
- Renamed `isLinuxDeb` to `isLinuxNonAppImage` for accuracy (covers all non-AppImage Linux builds)

## [0.5.0] - 2026-02-17

### Added
- **Adjustable guide appearance** — category sidebar width and background opacity sliders in Settings → EPG

### Fixed
- macOS auto-updater now works — added zip build target required by electron-updater
- Release workflow uploads macOS zip to GitHub release assets
- Opacity stacking flicker — EPG panel uses positioning instead of padding when categories are visible, preventing double-layer opacity overlap during transitions

### Changed
- **Settings architecture** — all app settings consolidated into Zustand store, hydrated once at startup. Eliminates redundant IPC calls (previously each component independently fetched settings from disk). Settings changes are now reactive across the app.
- Settings tab renamed from "Channels" to "EPG" with new Guide Appearance section
- Settings content area is now scrollable with a styled scrollbar
- Sort order dropdown themed to match other settings controls

## [0.4.0] - 2026-02-15

### Added
- **Native in-window video on macOS** - Video now renders directly inside the app window using a native mpv-texture addon with GPU-accelerated IOSurface sharing (replaces external mpv window)
- Screen sleep prevention during video playback on all platforms
- macOS: `which mpv` PATH fallback for non-standard installs (MacPorts, Nix, custom prefix)

### Fixed
- Mutex lock ordering in native mpv context to prevent potential deadlock
- WebGL draw errors now logged with throttling and context loss detection
- Native texture bridge escalates to error callback after 5 consecutive frame failures
- Render thread fires error callback if GL context initialization fails
- IPC handlers wrapped in try-catch with debug logging
- Partial bridge destroyed on init failure (resource leak fix)
- Comment inaccuracies corrected across native addon
- Unified MpvStatus types across native bridge, preload, and UI layers
- Removed duplicate dependency and redundant addon import

### Changed
- macOS builds are now **arm64 (Apple Silicon) only** — Intel Mac support discontinued
- macOS no longer bundles an external mpv binary — uses native addon with system mpv as fallback
- CI workflows updated for native addon build pipeline (brew + node-gyp + dylib bundling)

### Known Issues
- Linux: Video plays in a separate window rather than embedded

## [0.3.1] - 2026-02-07

### Fixed
- "Check for Updates" no longer falsely shows "Update available" when already on the latest version
- CI: build pipeline no longer fails on GitHub release creation

## [0.3.0] - 2026-02-06

### Added
- Auto-updater: app checks for updates on launch and notifies when a new version is ready to install (NSIS installer only)
- Auto-update toggle in Settings → About to disable automatic update checks
- About tab with version display, manual update check button, and project links
- GitHub issues link in Debug settings tab
- Page slide animations and persisted navigation state for VOD browsing
- Randomized hero featured content on each app session

### Fixed
- TMDB title matching: strip provider language prefixes (e.g. "[EN]", "FR -") for more accurate metadata
- External links now open in system browser instead of Electron window
- Hero section no longer flickers when switching data sources
- About tab layout stabilized, hero token loading fixed
- Portable builds correctly skip auto-updater and show GitHub releases link

### Security
- Validate URL protocol in window open handler (https/http only)
- Block top-level navigation hijack via will-navigate handler
- Guard updater install with download verification flag
- Forward auto-updater errors to renderer for user visibility

### Changed
- Title bar darkened to match EPG guide panel opacity
- Extracted shared DetailHeader component for Movie/Series detail views
- Extracted useVodNavigation hook to reduce store branching duplication
- Extracted useVodPageAnimation hook from VodPage
- Replaced clipboard copy with external link for GitHub issues in Debug tab
- Moved AboutTab inline styles to CSS file
- Replaced magic timeout values with named constants
- Settings sidebar scrollbar now matches dark theme used elsewhere

### Known Issues
- Linux/macOS: Video plays in a separate window rather than embedded

## [0.2.2] - 2026-02-04

### Fixed
- Linux: Black screen with audio on certain configurations - now uses separate window mode for video playback
- Linux: Removed HDR flags that caused video rendering issues on some systems

### Changed
- Linux: Enabled verbose mpv logging for easier debugging of playback issues

### Known Issues
- Linux/macOS: Video plays in a separate window rather than embedded. Fully embedded playback works great on Windows, but Linux and macOS present non-trivial embedding challenges that are still being worked on.

## [0.2.1] - 2026-01-31

### Fixed
- macOS: Video not displaying due to bundled mpv issues - now prefers system mpv (`brew install mpv`) (needs testing)
- macOS: Added helpful error dialog with Homebrew install instructions when mpv not found
- Linux: Desktop icon not displaying - use properly sized 512x512 icon per freedesktop spec (needs testing)

## [0.2.0] - 2026-01-31

### Added
- Debug logging with file output and log rotation (Settings → Debug)
- Settings sidebar with organized tabs (General, Library, Debug)
- Clear all cached data button for troubleshooting
- Auto-hide UI controls and cursor during playback inactivity
- M3U EPG sync from external URLs (gzip supported)
- Web Worker for EPG parsing to prevent UI freezing on large files
- Channel number ordering - sort by provider's channel numbers (tvg-chno / Xtream num)
- Configurable staleness intervals for EPG and VOD auto-refresh

### Changed
- Settings UI reorganized into sidebar navigation
- XMLTV parser extracted to shared local-adapter module

## [0.1.0] - 2026-01-25

### Added
- Live TV browsing with category filtering
- EPG program guide display
- Movies browsing with TMDB metadata matching
- TV Series browsing with season/episode navigation
- mpv-based playback with hardware acceleration
- Multi-source support (Xtream Codes API)
- Stream URL fallback logic (.ts → .m3u8 → .m3u)
- Global sync status indicator
- Offline database (IndexedDB) for channels, EPG, and VOD
- Multi-platform builds (Windows, macOS, Linux)
- Bundled mpv for Windows and macOS
