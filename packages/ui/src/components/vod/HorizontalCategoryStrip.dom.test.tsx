// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HorizontalCategoryStrip, type HorizontalCategoryStripProps } from './HorizontalCategoryStrip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

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
});
