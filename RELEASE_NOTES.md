# sbtlTV 0.18.0

A reworked guide: what's on under each channel, show details on hover, and a clearer now.

## Added

- **What's on, under each channel** - the show on now and how far along it is, under each channel name in the guide, whatever time the guide is showing. Channels with no guide data stay as they were. Turn it off in Settings > Guide > What's on, under each channel.
- **Show details on hover** - rest the pointer on a show for its title, time left (or when it starts), times, length and description. It opens at the show's start and replaces the plain tooltip.
- **sbtltv.com in About** - the sbtlTV logo at the bottom of Settings > About opens the site, for sharing sbtlTV.

## Improved

- **Now stands out** - the show on now is tinted, with the part already aired a little brighter, and a small marker sits over the time ruler at now, with dots on the half hours.
- **The guide starts on the half hour** - at the :00 or :30 before now, not the current minute.
- **Ended shows are outlined** - in the first minutes after :00 or :30, and when you look back, shows that already ended are an outline instead of a filled block, so they don't look like they're coming up.
- **Long channel names** slide to show their end when you point at the row.
- **Firmer corners** across the app.
- **Continue Watching has arrows** like the other rows (a mouse wheel can't scroll sideways on Linux and Windows).

## Fixed

- **The Genres panel** blurs what's behind it again; in 0.17.0 it showed clear.

## Known issues

- **Sync and Send a setup need 0.17.0 or newer on both computers.**
- **Sync and Send a setup aren't in the Windows portable version.** Use the installer (it also updates itself).
- **Widescreen SD channels still play small on macOS.**
