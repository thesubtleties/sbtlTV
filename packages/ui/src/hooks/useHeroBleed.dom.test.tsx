// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { chromeFade, useHeroBleed } from './useHeroBleed';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('chromeFade', () => {
  it('is 0 at the top, 1 once the hero has passed under the bars, never outside 0..1', () => {
    expect(chromeFade(0, 700, 100)).toBe(0);
    expect(chromeFade(300, 700, 100)).toBe(0.5);
    expect(chromeFade(900, 700, 100)).toBe(1);
    expect(chromeFade(-20, 700, 100)).toBe(0);
    expect(chromeFade(10, 50, 100)).toBe(1);   // a hero shorter than the bars
    expect(chromeFade(0, 100, 100)).toBe(0);   // a hero exactly the bars' height: no 0/0
  });
});

describe('useHeroBleed', () => {
  it('marks the root while active and leaves nothing behind when Movies closes', async () => {
    function Page({ on }: { on: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useHeroBleed(on, ref, 0);
      return createElement('div', { ref }, createElement('div', { className: 'hero' }), createElement('div', { className: 'h-category-strip' }));
    }
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Page, { on: true })));
    expect(document.documentElement.classList.contains('hero-bleed')).toBe(true);
    await act(async () => root.render(createElement(Page, { on: false })));
    expect(document.documentElement.classList.contains('hero-bleed')).toBe(false);
    await act(async () => root.render(createElement(Page, { on: true })));
    await act(async () => root.unmount());
    expect(document.documentElement.classList.contains('hero-bleed')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--chrome-fade')).toBe('');
    host.remove();
  });

  const frame = () => act(async () => { await new Promise((r) => requestAnimationFrame(r)); });
  function Sized({ on, startTop }: { on: boolean; startTop: number }) {
    const ref = useRef<HTMLDivElement>(null);
    useHeroBleed(on, ref, startTop);
    const sized = (h: number) => (el: HTMLElement | null) => { if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: h }); };
    return createElement('div', { ref }, createElement('div', { className: 'hero', ref: sized(700) }), createElement('div', { className: 'h-category-strip', ref: sized(68) }));
  }

  it('on the next frame: --bleed-chrome is the title bar + header, the fade starts from the restored scroll', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Sized, { on: true, startTop: 300 })));
    await frame();
    expect((host.firstElementChild as HTMLElement).style.getPropertyValue('--bleed-chrome')).toBe('100px');
    expect(document.documentElement.style.getPropertyValue('--chrome-fade')).toBe('0.500');
    await act(async () => root.unmount()); host.remove();
  });

  it('leaving the home before the first frame leaves no fade behind for the grids', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      flushSync(() => root.render(createElement(Sized, { on: true, startTop: 0 })));
      flushSync(() => root.render(createElement(Sized, { on: false, startTop: 0 })));   // a category picked within the frame
    });
    await frame();
    expect(document.documentElement.style.getPropertyValue('--chrome-fade')).toBe('');
    await act(async () => root.unmount()); host.remove();
  });
});
