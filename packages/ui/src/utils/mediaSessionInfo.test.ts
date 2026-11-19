import { describe, expect, it } from 'vitest';
import { mediaSessionInfo } from './mediaSessionInfo';

describe('mediaSessionInfo', () => {
  it('a movie: its title, the year under it, its art', () => {
    expect(mediaSessionInfo({ vod: { type: 'movie', title: 'Runner', year: '2026', art: 'https://img/r.jpg' } })).toEqual({
      title: 'Runner', artist: '2026', album: 'sbtlTV', artwork: [{ src: 'https://img/r.jpg' }],
    });
  });
  it('an episode: the episode line, the series under it', () => {
    expect(mediaSessionInfo({ vod: { type: 'series', title: 'Severance', episodeInfo: 'S2 E3 · Who Is Alive?', art: 'https://img/s.jpg' } })).toEqual({
      title: 'S2 E3 · Who Is Alive?', artist: 'Severance', album: 'sbtlTV', artwork: [{ src: 'https://img/s.jpg' }],
    });
  });
  it('live: what is on, the channel under it, the channel logo; just the channel without guide data', () => {
    expect(mediaSessionInfo({ live: { channel: 'ESPN', logo: 'https://img/espn.png', program: 'College Football' } })).toEqual({
      title: 'College Football', artist: 'ESPN', album: 'sbtlTV', artwork: [{ src: 'https://img/espn.png' }],
    });
    expect(mediaSessionInfo({ live: { channel: 'ESPN', logo: '', program: null } })).toEqual({
      title: 'ESPN', artist: '', album: 'sbtlTV', artwork: [],
    });
  });
  it('nothing playing: nothing to show', () => {
    expect(mediaSessionInfo({})).toBeNull();
  });
});
