import { describe, it, expect } from 'vitest';
import { resolveSeek, resolveVolumeStep, resolveLiveJump } from './playbackKeys';

const watching = { position: 100, duration: 600, volume: 50, activeView: 'none', categoriesOpen: false };

describe('resolveSeek', () => {
  it('maps the arrow keys to mpv seek deltas', () => {
    expect(resolveSeek('ArrowLeft', watching)).toBe(95);
    expect(resolveSeek('ArrowRight', watching)).toBe(105);
    expect(resolveSeek('ArrowUp', watching)).toBe(160);
    expect(resolveSeek('ArrowDown', watching)).toBe(40);
  });

  it('ignores keys that are not seek keys', () => {
    expect(resolveSeek('Enter', watching)).toBeNull();
    expect(resolveSeek('9', watching)).toBeNull();
  });

  it('clamps to the start and end of the stream', () => {
    expect(resolveSeek('ArrowLeft', { ...watching, position: 2 })).toBe(0);
    expect(resolveSeek('ArrowUp', { ...watching, position: 590 })).toBe(600);
  });

  it('leaves the arrows to the guide and library views', () => {
    expect(resolveSeek('ArrowLeft', { ...watching, activeView: 'guide' })).toBeNull();
    expect(resolveSeek('ArrowRight', { ...watching, activeView: 'movies' })).toBeNull();
    expect(resolveSeek('ArrowRight', { ...watching, categoriesOpen: true })).toBeNull();
  });

  it('does nothing for live streams, which have no duration', () => {
    expect(resolveSeek('ArrowRight', { ...watching, duration: 0 })).toBeNull();
  });
});

describe('resolveVolumeStep', () => {
  it('steps and clamps to 0..100', () => {
    expect(resolveVolumeStep(50, 5)).toBe(55);
    expect(resolveVolumeStep(98, 5)).toBe(100);
    expect(resolveVolumeStep(3, -5)).toBe(0);
  });

  it('rounds fractional volumes reported by mpv', () => {
    expect(resolveVolumeStep(49.6, 5)).toBe(55);
  });
});

describe('live rewind keys', () => {
  const live = { position: 100, duration: 0, volume: 50, activeView: 'none', categoriesOpen: false, liveRange: { start: 20, end: 300 } };
  it('arrows seek inside the buffer', () => {
    expect(resolveSeek('ArrowLeft', live)).toBe(95);
    expect(resolveSeek('ArrowDown', { ...live, position: 50 })).toBe(20);   // clamped to the oldest point
    expect(resolveSeek('ArrowUp', { ...live, position: 280 })).toBe(300);   // clamped to live
  });
  it('the rewind range wins even when the live stream reports a duration', () => {
    expect(resolveSeek('ArrowDown', { ...live, duration: 40, position: 50 })).toBe(20);
  });
  it('arrows stay inert on live without rewind', () => {
    expect(resolveSeek('ArrowLeft', { ...live, liveRange: null })).toBeNull();
  });
  it('End jumps to live only with rewind on and the video in front', () => {
    expect(resolveLiveJump('End', live)).toBe(300);
    expect(resolveLiveJump('End', { ...live, liveRange: null })).toBeNull();
    expect(resolveLiveJump('End', { ...live, activeView: 'guide' })).toBeNull();
    expect(resolveLiveJump('Home', live)).toBeNull();
  });
});
