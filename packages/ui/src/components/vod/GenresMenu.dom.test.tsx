// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GenresMenu } from './GenresMenu';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cats = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, displayName: `Genre ${i}` }));
let root: Root; let host: HTMLElement; let picked: string[];
const key = (k: string) => act(async () => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
const open = () => act(async () => (host.querySelector('.h-category-strip__genres-btn') as HTMLButtonElement).click());
const focused = () => (document.activeElement as HTMLElement).textContent;
const button = () => host.querySelector('.h-category-strip__genres-btn') as HTMLButtonElement;
async function mount(selectedId: string | null = null) {
  const containerRef = createRef<HTMLDivElement>();
  await act(async () => root.render(createElement('div', { ref: containerRef }, createElement(GenresMenu, { categories: cats, selectedId, onSelect: (id: string) => picked.push(id), containerRef }))));
}
beforeEach(() => { vi.useFakeTimers(); picked = []; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('GenresMenu', () => {
  it('labels the button with the open category, else "Genres"', async () => {
    await mount(); expect(button().textContent).toBe('Genres');
    await mount('c3'); expect(button().textContent).toBe('Genre 3');
  });

  it('opens with focus on the open category (or the first); arrows move by item and by row of 4; Home/End', async () => {
    await mount('c5'); await open();
    expect(host.querySelector('[role=menu]')).not.toBeNull();
    expect(focused()).toBe('Genre 5');
    await key('ArrowRight'); expect(focused()).toBe('Genre 6');
    await key('ArrowDown'); expect(focused()).toBe('Genre 9');   // 6 + 4 is past the end: the last item
    await key('Home'); expect(focused()).toBe('Genre 0');
    await key('End'); expect(focused()).toBe('Genre 9');
    await key('ArrowUp'); expect(focused()).toBe('Genre 5');
  });

  it('Enter picks and closes; Escape closes and puts focus back on Genres; Tab closes', async () => {
    await mount(); await open(); await key('ArrowRight'); await key('Enter');
    expect(picked).toEqual(['c1']);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); }); expect(host.querySelector('[role=menu]')).toBeNull();
    await open(); await key('Escape'); await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(host.querySelector('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(button());
    await open(); await key('Tab'); await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(host.querySelector('[role=menu]')).toBeNull();
  });

  it('a click outside the capsule closes it; a click inside does not', async () => {
    await mount(); await open();
    await act(async () => host.firstElementChild!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(button().getAttribute('aria-expanded')).toBe('true');
    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  it('ArrowLeft goes back; ArrowUp on the first row stays put; Space picks', async () => {
    await mount('c2'); await open();
    await key('ArrowLeft'); expect(focused()).toBe('Genre 1');
    await key('ArrowUp'); expect(focused()).toBe('Genre 0');   // 1 - 4 is before the start: the first item
    await key(' '); expect(picked).toEqual(['c0']);
  });

  it('the panel stays drawn while it shrinks away, then goes; reopening mid-close keeps it open', async () => {
    await mount(); await open(); await key('Escape');
    expect(host.querySelector('.h-category-strip__sheet--closing')).not.toBeNull();
    expect(button().getAttribute('aria-expanded')).toBe('false');
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await open();   // back open before the 320 ms close finished
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(host.querySelector('[role=menu]')).not.toBeNull();
    expect(host.querySelector('.h-category-strip__sheet--closing')).toBeNull();
  });

  it('clicking Genres again closes it', async () => {
    await mount(); await open(); await open();
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  it('marks the open category on the button and in the panel; only the focused item is in the Tab order', async () => {
    await mount('c3'); await open();
    expect(button().classList.contains('active')).toBe(true);
    expect([...host.querySelectorAll('.h-category-strip__sheet-item.active')].map((b) => b.textContent)).toEqual(['Genre 3']);
    expect([...host.querySelectorAll('[role=menuitem]')].filter((b) => b.getAttribute('tabindex') === '0').map((b) => b.textContent)).toEqual(['Genre 3']);
    await mount(); expect(button().classList.contains('active')).toBe(false);
  });

  it('stops listening for outside clicks once closed', async () => {
    const add = vi.spyOn(document, 'addEventListener'); const remove = vi.spyOn(document, 'removeEventListener');
    await mount(); await open(); await key('Escape');
    const count = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'pointerdown').length;
    expect(count(add)).toBe(1); expect(count(remove)).toBe(1);
    add.mockRestore(); remove.mockRestore();
  });

  it('keys the panel handles never reach the app (Escape would close Movies, Space would pause)', async () => {
    const reached: string[] = [];
    const onWindow = (e: KeyboardEvent) => reached.push(e.key);
    window.addEventListener('keydown', onWindow);
    await mount(); await open();
    await key('ArrowDown'); await key('Home'); await key('Escape');   // moving, then closing
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await open(); await key(' ');                                       // picking
    window.removeEventListener('keydown', onWindow);
    expect(reached).toEqual([]);
  });

  it('picking a genre puts focus back on the Genres button', async () => {
    await mount(); await open(); await key('ArrowRight'); await key('Enter');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(document.activeElement).toBe(button());
  });

  it('the panel closes when the view changes underneath it (Home or All picked)', async () => {
    await mount('c2'); await open();
    await mount(null);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(host.querySelector('[role=menu]')).toBeNull();
  });

  it('a closing panel takes no clicks or focus', async () => {
    await mount(); await open(); await key('Escape');
    expect(host.querySelector('[role=menu]')?.hasAttribute('inert')).toBe(true);
  });
});
