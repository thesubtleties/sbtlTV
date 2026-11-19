// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useUIStore } from '../stores/uiStore';
import { useRematchFavorites } from './useRematchFavorites';

const listeners: ((p: { stage: string; state: string }) => void)[] = [];
vi.mock('../data/client', () => ({ data: { onSync: (cb: (p: { stage: string; state: string }) => void) => { listeners.push(cb); return () => {}; } } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); listeners.length = 0; useUIStore.getState().hydrateSources([]); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('useRematchFavorites', () => {
  it('matches again when a source is added or turned off, and when a channel sync finishes (not when one starts)', async () => {
    const rematch = vi.fn(async () => {});
    const Probe = () => { useRematchFavorites(rematch); return null; };
    await act(async () => { root.render(createElement(Probe)); });
    expect(rematch).not.toHaveBeenCalled();   // no sources yet
    await act(async () => { useUIStore.getState().hydrateSources([{ id: 'm1', name: 'A', type: 'm3u', url: 'http://a.example', enabled: true }]); });
    expect(rematch).toHaveBeenCalledTimes(1);
    await act(async () => { useUIStore.getState().hydrateSources([{ id: 'm1', name: 'A', type: 'm3u', url: 'http://a.example', enabled: false }]); });
    expect(rematch).toHaveBeenCalledTimes(2);
    await act(async () => { listeners.forEach((l) => l({ stage: 'channels', state: 'started' })); });
    expect(rematch).toHaveBeenCalledTimes(2);
    await act(async () => { listeners.forEach((l) => l({ stage: 'channels', state: 'finished' })); });
    expect(rematch).toHaveBeenCalledTimes(3);
  });
});
