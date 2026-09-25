import { describe, it, expect } from 'vitest';
import { resolveSeek, resolveVolumeStep } from './playbackKeys';

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
