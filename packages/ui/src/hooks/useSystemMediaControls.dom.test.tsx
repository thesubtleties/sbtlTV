// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useSystemMediaControls, type SystemMediaControlsInput } from './useSystemMediaControls';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = ((d: { seekTime?: number; seekOffset?: number }) => void) | null;
let session: { metadata: unknown; playbackState: string; handlers: Record<string, Handler>; setActionHandler: (a: string, h: Handler) => void; setPositionState: ReturnType<typeof vi.fn> };
let play: ReturnType<typeof vi.fn>; let pause: ReturnType<typeof vi.fn>;

beforeEach(() => {
  session = { metadata: null, playbackState: 'none', handlers: {}, setActionHandler(a, h) { this.handlers[a] = h; }, setPositionState: vi.fn() };
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
  (globalThis as { MediaMetadata?: unknown }).MediaMetadata = class { constructor(init: object) { Object.assign(this, init); } };
  play = vi.fn(() => Promise.resolve()); pause = vi.fn();
  HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement['play'];
  HTMLMediaElement.prototype.pause = pause as unknown as HTMLMediaElement['pause'];
  URL.createObjectURL = vi.fn(() => 'blob:silence');
});
afterEach(() => { delete (navigator as { mediaSession?: unknown }).mediaSession; });

const actions = () => ({ play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn() });
const movie = { title: 'Runner', artist: '2026', album: 'sbtlTV', artwork: [] };

async function mount(input: SystemMediaControlsInput) {
  function Probe(p: SystemMediaControlsInput) { useSystemMediaControls(p); return null; }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(Probe, input)));
  return {
    rerender: (next: SystemMediaControlsInput) => act(async () => root.render(createElement(Probe, next))),
    done: async () => { await act(async () => root.unmount()); host.remove(); },
  };
}

describe('useSystemMediaControls', () => {
  it('playing: the silent clip plays (the OS only lists a page that plays audio), with what is playing and the buttons', async () => {
    const a = actions();
    const m = await mount({ enabled: true, info: movie, playing: true, seekable: true, duration: 6420, getPosition: () => 1234, actions: a });
    expect(play).toHaveBeenCalled();
    expect(session.metadata).toMatchObject({ title: 'Runner', artist: '2026' });
    expect(session.playbackState).toBe('playing');
    for (const h of ['play', 'pause', 'stop', 'seekto', 'seekbackward', 'seekforward']) expect(session.handlers[h]).toBeTypeOf('function');
    // Previous / next stay off (owner's call)
    expect(session.handlers.previoustrack ?? null).toBeNull();
    expect(session.handlers.nexttrack ?? null).toBeNull();
    expect(session.setPositionState).toHaveBeenCalledWith({ duration: 6420, position: 1234, playbackRate: 1 });
    await m.done();
  });

  it('the OS buttons reach the player', async () => {
    const a = actions();
    const m = await mount({ enabled: true, info: movie, playing: true, seekable: true, duration: 6420, getPosition: () => 1234, actions: a });
    session.handlers.pause!({}); session.handlers.play!({}); session.handlers.stop!({});
    session.handlers.seekto!({ seekTime: 600 });
    session.handlers.seekbackward!({}); session.handlers.seekforward!({ seekOffset: 30 });
    expect(a.pause).toHaveBeenCalledTimes(1); expect(a.play).toHaveBeenCalledTimes(1); expect(a.stop).toHaveBeenCalledTimes(1);
    expect(a.seek.mock.calls.map((c) => c[0])).toEqual([600, 1224, 1264]);
    await m.done();
  });

  it('paused: shown paused, the clip pauses with it', async () => {
    const m = await mount({ enabled: true, info: movie, playing: true, seekable: true, duration: 6420, getPosition: () => 10, actions: actions() });
    await m.rerender({ enabled: true, info: movie, playing: false, seekable: true, duration: 6420, getPosition: () => 10, actions: actions() });
    expect(session.playbackState).toBe('paused');
    expect(pause).toHaveBeenCalled();
    await m.done();
  });

  it('live: no seeking and no timeline', async () => {
    const m = await mount({ enabled: true, info: { title: 'College Football', artist: 'ESPN', album: 'sbtlTV', artwork: [] }, playing: true, seekable: false, duration: 0, getPosition: () => 0, actions: actions() });
    expect(session.handlers.seekto ?? null).toBeNull();
    expect(session.setPositionState).not.toHaveBeenCalledWith(expect.objectContaining({ duration: expect.any(Number) }));
    await m.done();
  });

  it('the Privacy switch off, or nothing playing: nothing at all reaches the OS', async () => {
    const m = await mount({ enabled: false, info: movie, playing: true, seekable: true, duration: 6420, getPosition: () => 1, actions: actions() });
    expect(play).not.toHaveBeenCalled();
    expect(session.metadata).toBeNull();
    // Turned on, then playback ends: cleared again
    await m.rerender({ enabled: true, info: movie, playing: true, seekable: true, duration: 6420, getPosition: () => 1, actions: actions() });
    expect(session.metadata).not.toBeNull();
    await m.rerender({ enabled: true, info: null, playing: false, seekable: false, duration: 0, getPosition: () => 0, actions: actions() });
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
    expect(session.handlers.play ?? null).toBeNull();
    await m.done();
  });
});
