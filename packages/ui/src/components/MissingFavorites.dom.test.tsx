// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '../db';
import { useUIStore } from '../stores/uiStore';
import { useWaitingFavorites } from '../hooks/useFavorites';
import { MissingFavoriteRows } from './MissingFavorites';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(async () => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); await db.favorites.clear(); });
afterEach(() => { act(() => root.unmount()); host.remove(); useUIStore.getState().updateSettings({ syncMissingChannels: undefined }); });
const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

const row = (id: string, over = {}) => ({ id, type: 'channel' as const, name: id, added: new Date(1), ...over });

describe('grayed favorites (DOM)', () => {
  it('Remove hands back the row it sits on', async () => {
    const onRemove = vi.fn();
    const rows = [row('ESPN', { ids: [{ host: 'h', ch: '1' }] }), row('HBO', { ids: [{ host: 'h', ch: '2' }] })];
    await act(async () => { root.render(createElement(MissingFavoriteRows, { rows, onRemove })); });
    const buttons = [...host.querySelectorAll('button')];
    await act(async () => { buttons[1].click(); });
    expect(onRemove).toHaveBeenCalledWith(rows[1]);
  });

  it('the Guide shows none until the setting says Gray out', async () => {
    await db.favorites.bulkPut([row('ESPN', { ids: [{ host: 'h', ch: '1' }] }), row('m1', { stream_id: 'm1_1' })]);
    const seen: string[][] = [];
    const Probe = () => { seen.push(useWaitingFavorites().map((f) => f.id)); return null; };
    await act(async () => { root.render(createElement(Probe)); });
    await settle();
    expect(seen[seen.length - 1]).toEqual([]);
    await act(async () => { useUIStore.getState().updateSettings({ syncMissingChannels: 'gray' }); });
    await settle();
    expect(seen[seen.length - 1]).toEqual(['ESPN']);
  });
});
