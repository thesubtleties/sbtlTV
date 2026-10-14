# sbtlTV 0.12.1

A privacy release.

## Added

- **Settings > Privacy** - what stays on your computer (including whether your saved passwords are encrypted), a Check button that shows the IP address outside services see, and who sbtlTV talks to and what each one sees.

## Changed

- **Team logos on live games are off by default** - they load from ESPN. Turn them on in Settings > EPG > Team logos.

## Improved

- **Team logos** sit apart with "@" or "vs" between them, and more games are recognized from their guide descriptions.

## Fixed

- **No more request to Google on first launch** on Windows and Linux (Chromium's spell-check dictionary).
- **Login details are cleaned from terminal and system log output too**, as in the debug log since 0.12.0.
- **A provider's unreadable reply could put login details in an error message.**

## Known issues

- **Memory use can climb during in-window playback on macOS and Linux** - it mostly levels off and is released when you change channel or title. Still being watched.
- **Widescreen SD channels still play small on macOS.**
