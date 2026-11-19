/** What the system media controls show (Windows media panel, macOS Now Playing, Linux MPRIS): MediaMetadata's fields. */
export interface MediaSessionInfo { title: string; artist: string; album: string; artwork: { src: string }[] }

interface Input {
  vod?: { type: 'movie' | 'series'; title: string; year?: string; episodeInfo?: string; art?: string };
  live?: { channel: string; logo?: string; program?: string | null };
}

const art = (src?: string) => (src ? [{ src }] : []);

/** A movie: title over its year. An episode: the episode line over the series. Live: what's on over the channel. */
export function mediaSessionInfo({ vod, live }: Input): MediaSessionInfo | null {
  if (vod) {
    if (vod.type === 'series' && vod.episodeInfo) return { title: vod.episodeInfo, artist: vod.title, album: 'sbtlTV', artwork: art(vod.art) };
    return { title: vod.title, artist: vod.year ?? '', album: 'sbtlTV', artwork: art(vod.art) };
  }
  if (live) {
    return live.program
      ? { title: live.program, artist: live.channel, album: 'sbtlTV', artwork: art(live.logo) }
      : { title: live.channel, artist: '', album: 'sbtlTV', artwork: art(live.logo) };
  }
  return null;
}
