/**
 * Playback position - kept out of App state on purpose.
 *
 * mpv reports the position up to 10 times a second. As App state, every tick
 * re-rendered the whole tree (the hidden guide included), which on slower
 * machines blocked the renderer's main thread long enough to delay video
 * frames. Only the now-playing bar subscribes; everything else reads it with
 * getState() when it needs the current value.
 */

import { create } from 'zustand';

interface PlaybackState {
  position: number;
  setPosition: (position: number) => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  position: 0,
  setPosition: (position) => set({ position }),
}));
