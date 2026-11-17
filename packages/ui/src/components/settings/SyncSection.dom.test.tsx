// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useUIStore } from '../../stores/uiStore';
import { SyncSection } from './SyncSection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const parts = { watchlist: true, progress: true, settings: false, favorites: true };
const view = { status: 'active', lastSync: null, parts, name: 'Linux PC', defaultName: 'Linux PC', interrupted: [], computers: [{ id: 'a', name: 'Linux PC', thisOne: true, lastSeen: null }] };
let setParts: ReturnType<typeof vi.fn>;
let saved: unknown[];
let root: Root;
let host: HTMLElement;

beforeEach(() => {
  setParts = vi.fn(async () => {}); saved = [];
  Object.assign(window, {
    sync: { view: async () => view, onView: () => () => {}, setParts },
    storage: { updateSettings: async (s: unknown) => { saved.push(s); return {}; } },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); useUIStore.getState().updateSettings({ syncMissingChannels: undefined }); });

const rowOf = (title: string) => [...host.querySelectorAll('.st-row')].find((r) => r.querySelector('.st-row__title')?.textContent === title) as HTMLElement;
const radio = (title: string, label: string) => [...rowOf(title).querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
const render = async () => { await act(async () => { root.render(createElement(SyncSection, { adding: false, onAdding: () => {} })); }); };

describe('SyncSection: favorites (DOM)', () => {
  it('a Favorites switch, on by default, that turns only that part off', async () => {
    await render();
    expect(radio('Favorites', 'On').getAttribute('aria-checked')).toBe('true');
    await act(async () => { radio('Favorites', 'Off').click(); });
    expect(setParts).toHaveBeenCalledWith({ ...parts, favorites: false });
  });
  it("channels this computer doesn't have: Hide by default; Gray out applies at once and is saved", async () => {
    await render();
    const title = "Channels this computer doesn't have";
    expect(radio(title, 'Hide').getAttribute('aria-checked')).toBe('true');
    await act(async () => { radio(title, 'Gray out').click(); });
    expect(useUIStore.getState().settings.syncMissingChannels).toBe('gray');
    expect(saved).toContainEqual({ syncMissingChannels: 'gray' });
  });
});
