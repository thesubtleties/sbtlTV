// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HorizontalCategoryStrip, type HorizontalCategoryStripProps } from './HorizontalCategoryStrip';
import { highlightTarget } from './capsuleHighlight';
import { useUIStore } from '../../stores/uiStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement;
const SETTINGS = { ...useUIStore.getState().settings };
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); useUIStore.setState({ settings: { ...SETTINGS } }); });

function renderStrip(props: Partial<HorizontalCategoryStripProps> = {}) {
  return act(async () => root.render(createElement(HorizontalCategoryStrip, {
    categories: [{ id: 'c1', name: 'Comedy' }, { id: 'c2', name: 'Arabic Animation Series' }, { id: 'c3', name: 'Drama' }],
    selectedId: null, onSelect: () => {}, type: 'movie', onBack: () => {}, searchQuery: '', onSearchChange: () => {}, ...props,
  })));
}

describe('Movies & Series header', () => {
  it('Simple: Home is the active tab on the home; every category is a tab', async () => {
    await renderStrip();
    expect(host.querySelector('.h-category-strip__pill.active')?.textContent).toBe('Home');
    expect([...host.querySelectorAll('.h-category-strip__pill')].map((b) => b.textContent)).toEqual(['Home', 'All', 'Arabic Animation Series', 'Comedy', 'Drama']);   // categories A–Z
  });

  it('the highlight goes to a visible active item: a hidden category tab never wins over Genres', () => {
    const nav = document.createElement('div');
    nav.innerHTML = '<button class="h-category-strip__pill">Home</button><button class="h-category-strip__pill active" style="display:none">Comedy</button><button class="h-category-strip__genres-btn active">Comedy</button>';
    document.body.append(nav);
    expect(highlightTarget(nav)?.className).toContain('genres-btn');
    nav.remove();
  });

  it('clicking anywhere on the search circle focuses the search input', async () => {
    await renderStrip();
    (host.querySelector('.h-category-strip__search') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.activeElement).toBe(host.querySelector('.h-category-strip__search input'));
  });

  it('switching style closes the Genres panel', async () => {
    const setHeader = (header: 'simple' | 'floating') => useUIStore.setState((s) => ({ settings: { ...s.settings, appearance: { palette: 'sbtl', typeface: 'fira', accent: 'palette', header } } }));
    await act(async () => setHeader('floating'));
    await renderStrip();
    await act(async () => (host.querySelector('.h-category-strip__genres-btn') as HTMLButtonElement).click());
    expect(host.querySelector('[role=menu]')).not.toBeNull();
    await act(async () => setHeader('simple'));
    expect(host.querySelector('[role=menu]')).toBeNull();   // GenresMenu is keyed by the style: a remount closes it
  });

  it('no highlight when nothing shown is active', async () => {
    await renderStrip({ selectedId: 'gone' });
    expect((host.querySelector('.h-category-strip__nav') as HTMLElement).style.getPropertyValue('--ind-o')).toBe('0');
    await renderStrip();
    expect((host.querySelector('.h-category-strip__nav') as HTMLElement).style.getPropertyValue('--ind-o')).toBe('1');
  });

  it('a long category name in the Genres button keeps its full name as a tooltip', async () => {
    await renderStrip({ selectedId: 'c2' });
    expect(host.querySelector('.h-category-strip__genres-label')?.getAttribute('title')).toBe('Arabic Animation Series');
  });
});
