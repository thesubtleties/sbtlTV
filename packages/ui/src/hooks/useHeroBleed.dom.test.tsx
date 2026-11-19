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
    expect(document.documentElement.getAttribute('style') ?? '').toBe('');
    host.remove();
  });

  const frame = () => act(async () => { await new Promise((r) => requestAnimationFrame(r)); });
  function Sized({ on, startTop }: { on: boolean; startTop: number }) {
    const ref = useRef<HTMLDivElement>(null);
    useHeroBleed(on, ref, startTop);
    const sized = (h: number) => (el: HTMLElement | null) => { if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: h }); };
    return createElement('div', { ref }, createElement('div', { className: 'vod-page__chrome-fill' }), createElement('div', { className: 'vod-page__chrome-shade' }), createElement('div', { className: 'hero', ref: sized(700) }), createElement('div', { className: 'h-category-strip', ref: sized(68) }));
  }

  it('on the next frame: --bleed-chrome is the title bar + header, the fade starts from the restored scroll', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Sized, { on: true, startTop: 300 })));
    await frame();
    expect((host.firstElementChild as HTMLElement).style.getPropertyValue('--bleed-chrome')).toBe('100px');
    // The fill is its own layer, driven by opacity: nothing on the root changes per scroll (a root variable would
    // make the whole app's styles recalculate every frame)
    expect((host.querySelector('.vod-page__chrome-fill') as HTMLElement).style.opacity).toBe('0.5');
    expect(document.documentElement.getAttribute('style') ?? '').toBe('');
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
    expect((host.querySelector('.h-category-strip') as HTMLElement).style.getPropertyValue('--bar-t')).toBe('');
    await act(async () => root.unmount()); host.remove();
  });

  it('nothing switches at a set point: the shade and the header follow the scroll, cleared on leaving', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Sized, { on: true, startTop: 150 })));
    await frame();
    const shade = host.querySelector('.vod-page__chrome-shade') as HTMLElement;
    const strip = host.querySelector('.h-category-strip') as HTMLElement;
    expect(shade.style.opacity).toBe('0.75');   // 150 / (700 - 100) = 0.25 filled
    expect(strip.style.getPropertyValue('--bar-t')).toBe('0.25');
    await act(async () => root.render(createElement(Sized, { on: false, startTop: 0 })));
    expect(strip.style.getPropertyValue('--bar-t')).toBe('');
    await act(async () => root.unmount()); host.remove();
  });

  it('once the home is covered (it was showing, then a detail opened), its scrolls leave the bars alone', async () => {
    const bar = document.createElement('div'); bar.className = 'title-bar'; document.body.append(bar);
    let scroll: (t: number) => void = () => {};
    function Page({ on }: { on: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      scroll = useHeroBleed(on, ref, 0).onScroll;
      const sized = (h: number) => (el: HTMLElement | null) => { if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: h }); };
      return createElement('div', { ref }, createElement('div', { className: 'hero', ref: sized(700) }), createElement('div', { className: 'h-category-strip', ref: sized(68) }));
    }
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Page, { on: true })));
    scroll(150);
    expect(bar.style.getPropertyValue('--bar-t')).toBe('0.25');
    await act(async () => root.render(createElement(Page, { on: false })));
    scroll(300);
    expect(bar.style.getPropertyValue('--bar-t')).toBe('');
    await act(async () => root.unmount()); host.remove(); bar.remove();
  });

  it('the title bar gets how far the bars have filled (--bar-t), so its logo and buttons follow the scroll; gone on leaving', async () => {
    const bar = document.createElement('div'); bar.className = 'title-bar'; document.body.append(bar);
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Sized, { on: true, startTop: 150 })));
    await frame();
    expect(bar.style.getPropertyValue('--bar-t')).toBe('0.25');   // 150 / (700 - 100)
    await act(async () => root.render(createElement(Sized, { on: false, startTop: 0 })));
    expect(bar.style.getPropertyValue('--bar-t')).toBe('');
    await act(async () => root.unmount()); host.remove(); bar.remove();
  });

  it('a home scroll while inactive (a detail covers it) leaves the title bar alone', async () => {
    const bar = document.createElement('div'); bar.className = 'title-bar'; document.body.append(bar);
    let scroll: (t: number) => void = () => {};
    function Grab() {
      const ref = useRef<HTMLDivElement>(null);
      scroll = useHeroBleed(false, ref, 0).onScroll;
      return createElement('div', { ref }, createElement('div', { className: 'hero' }), createElement('div', { className: 'h-category-strip' }));
    }
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Grab)));
    scroll(300);
    expect(bar.style.getPropertyValue('--bar-t')).toBe('');
    expect((host.querySelector('.h-category-strip') as HTMLElement).style.getPropertyValue('--bar-t')).toBe('');
    await act(async () => root.unmount()); host.remove(); bar.remove();
  });
});
