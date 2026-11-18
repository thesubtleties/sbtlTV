// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useDetailBleed } from './useHeroBleed';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const frame = () => act(async () => { await new Promise((r) => requestAnimationFrame(r)); });

// A detail: the scroller, its backdrop (332px tall: the bars are full once 300px have scrolled) and the two layers
function Detail({ on }: { on: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onScroll } = useDetailBleed(on, ref);
  const sized = (el: HTMLElement | null) => { if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 332 }); };
  // A long page by default (1200px to scroll)
  const page = (el: HTMLDivElement | null) => {
    ref.current = el;
    if (el && !Object.getOwnPropertyDescriptor(el, 'scrollHeight')) {
      Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 2000 });
      Object.defineProperty(el, 'clientHeight', { configurable: true, value: 800 });
    }
  };
  return createElement('div', { ref: page, className: 'scroller', onScroll: (e: { currentTarget: HTMLElement }) => onScroll(e.currentTarget.scrollTop) },
    createElement('div', { className: 'detail-bleed__fill' }),
    createElement('div', { className: 'detail-bleed__shade' }),
    createElement('div', { className: 'movie-detail__backdrop', ref: sized }));
}

describe('useDetailBleed', () => {
  it('clears the title bar at once while open, follows the scroll, and leaves nothing behind', async () => {
    const bar = document.createElement('div'); bar.className = 'title-bar'; document.body.append(bar);
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const html = document.documentElement;
    await act(async () => root.render(createElement(Detail, { on: true })));
    // The class is there before any frame: the title bar is clear the moment the detail opens
    expect(html.classList.contains('detail-bleed')).toBe(true);
    await frame();
    const fill = host.querySelector<HTMLElement>('.detail-bleed__fill')!;
    const shade = host.querySelector<HTMLElement>('.detail-bleed__shade')!;
    expect(fill.style.opacity).toBe('0');
    expect(shade.style.opacity).toBe('1');
    expect(bar.style.getPropertyValue('--bar-t')).toBe('0');
    const scroller = host.querySelector<HTMLElement>('.scroller')!;
    scroller.scrollTop = 75;
    await act(async () => { scroller.dispatchEvent(new Event('scroll', { bubbles: true })); });
    expect(fill.style.opacity).toBe('0.25');   // 75 / (332 - 32)
    expect(shade.style.opacity).toBe('0.75');
    expect(bar.style.getPropertyValue('--bar-t')).toBe('0.25');
    // Collapsed for the player: the title bar is as everywhere else
    await act(async () => root.render(createElement(Detail, { on: false })));
    expect(html.classList.contains('detail-bleed')).toBe(false);
    expect(bar.style.getPropertyValue('--bar-t')).toBe('');
    await act(async () => root.render(createElement(Detail, { on: true })));
    await act(async () => root.unmount());
    expect(html.classList.contains('detail-bleed')).toBe(false);
    host.remove(); bar.remove();
  });

  it('ignores scrolls while inactive (the title bar is left alone)', async () => {
    const bar = document.createElement('div'); bar.className = 'title-bar'; document.body.append(bar);
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Detail, { on: false })));
    const scroller = host.querySelector<HTMLElement>('.scroller')!;
    scroller.scrollTop = 150;
    await act(async () => { scroller.dispatchEvent(new Event('scroll', { bubbles: true })); });
    expect(bar.style.getPropertyValue('--bar-t')).toBe('');
    expect(host.querySelector<HTMLElement>('.detail-bleed__fill')!.style.opacity).toBe('');
    await act(async () => root.unmount()); host.remove(); bar.remove();
  });

  it('a page too short to scroll the backdrop away is fully filled at its end (not stuck half filled)', async () => {
    const bar = document.createElement('div'); bar.className = 'title-bar'; document.body.append(bar);
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Detail, { on: true })));
    const scroller = host.querySelector<HTMLElement>('.scroller')!;
    // Only 150px to scroll, though the backdrop needs 300 to pass under the bar
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 600 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 450 });
    scroller.scrollTop = 75;
    await act(async () => { scroller.dispatchEvent(new Event('scroll', { bubbles: true })); });
    expect(bar.style.getPropertyValue('--bar-t')).toBe('0.5');
    scroller.scrollTop = 150;
    await act(async () => { scroller.dispatchEvent(new Event('scroll', { bubbles: true })); });
    expect(bar.style.getPropertyValue('--bar-t')).toBe('1');
    await act(async () => root.unmount()); host.remove(); bar.remove();
  });
});
