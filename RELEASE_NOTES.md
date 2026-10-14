# sbtlTV 0.12.1

A privacy release.

## Added

- **Settings > Privacy** - who sbtlTV talks to and what each one sees, marked by whether it applies to you, plus a Check button that shows the IP address they see (asks Mullvad's public checker, only when clicked; nothing is saved).

## Changed

- **Team logos on live games are off by default** - they load from ESPN. Turn them on in Settings > EPG > Team logos.

## Fixed

- **No more request to Google on first launch** (Chromium's spell-check dictionary).
- **Provider usernames and passwords no longer appear in terminal or system log output** - stream links are cut to their host there too, as in the debug log since 0.12.0.

## Known issues

- **Memory use can climb during in-window playback on macOS and Linux** - it mostly levels off and is released when you change channel or title. Still being watched.
- **Widescreen SD channels still play small on macOS.**
