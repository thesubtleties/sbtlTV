// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GuideHoverLayer, HOVER_DELAY_MS, HOVER_HIDE_MS, HOVER_SKIP_DELAY_MS } from './GuideHoverLayer';
import type { GuideHoverApi } from './guideHover';
import type { StoredProgram } from '../db';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const at = (h: number, m: number) => new Date(2026, 10, 20, h, m);
const prog = (id: string, title: string): StoredProgram => ({ id, stream_id: 's', source_id: 'x', title, description: '', start: at(20, 0), end: at(21, 0) });
const A = prog('a', 'Show A');
const B = prog('b', 'Show B');

let root: Root; let host: HTMLElement; let block: HTMLElement;
const api = createRef<GuideHoverApi>();
const render = (resetKey = 'k', visible = true) =>
  act(() => { root.render(createElement(GuideHoverLayer, { apiRef: api, now: at(20, 15), visible, resetKey })); });
const card = () => document.querySelector('.ghc');
const title = () => card()?.querySelector('.ghc__title')?.textContent ?? null;
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  block = document.createElement('div'); document.body.appendChild(block);
  render();
});
afterEach(() => { act(() => root.unmount()); host.remove(); block.remove(); vi.useRealTimers(); });

describe('the guide hover card: when it shows and goes', () => {
  it('after resting the delay on a show, not before', () => {
    act(() => api.current!.show(A, block, 100));
    advance(HOVER_DELAY_MS - 1);
    expect(card()).toBeNull();
    advance(1);
    expect(title()).toBe('Show A');
  });
  it('moving to the next show swaps at once; leaving before the delay shows nothing', () => {
    act(() => api.current!.show(A, block, 100)); advance(HOVER_DELAY_MS);
    act(() => { api.current!.hide(); api.current!.show(B, block, 100); });
    expect(title()).toBe('Show B');
    act(() => api.current!.drop());
    act(() => { api.current!.show(A, block, 100); api.current!.hide(); });
    advance(1000);
    expect(card()).toBeNull();
  });
  it('crossing the gap between rows: a card hidden a moment ago comes straight back', () => {
    act(() => api.current!.show(A, block, 100)); advance(HOVER_DELAY_MS);
    act(() => api.current!.hide()); advance(HOVER_HIDE_MS);
    expect(card()).toBeNull();
    advance(HOVER_SKIP_DELAY_MS - HOVER_HIDE_MS - 1);
    act(() => api.current!.show(B, block, 100));
    expect(title()).toBe('Show B');
  });
  it('a show whose block is gone by the time its card would open is skipped (no card in the corner)', () => {
    act(() => api.current!.show(A, block, 100));
    block.remove();
    advance(HOVER_DELAY_MS);
    expect(card()).toBeNull();
  });
  it('gone when the grid changes under the pointer (resetKey), when the guide hides, or the window loses focus', () => {
    act(() => api.current!.show(A, block, 100)); advance(HOVER_DELAY_MS);
    render('moved');
    expect(card()).toBeNull();
    act(() => api.current!.show(A, block, 100)); advance(HOVER_DELAY_MS);
    render('moved', false);
    expect(card()).toBeNull();
    render('moved', true);
    act(() => api.current!.show(A, block, 100)); advance(HOVER_DELAY_MS);
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(card()).toBeNull();
  });
  it('unmounting with a card on its way leaves nothing behind', () => {
    act(() => api.current!.show(A, block, 100));
    act(() => root.unmount());
    advance(HOVER_DELAY_MS);
    expect(card()).toBeNull();
    root = createRoot(host);
  });
});

describe('the guide hover card: where it opens', () => {
  const place = (anchor: Partial<DOMRect>, x: number, size = { width: 360, height: 120 }) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('ghc')) return { ...size, left: 0, top: 0, right: size.width, bottom: size.height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      return { width: 100, height: 40, x: 0, y: 0, toJSON: () => ({}), ...anchor } as DOMRect;
    });
    act(() => api.current!.drop());
    act(() => api.current!.show(A, block, x)); advance(HOVER_DELAY_MS);
    const el = card() as HTMLElement;
    vi.restoreAllMocks();
    return { left: parseFloat(el.style.left), top: parseFloat(el.style.top), shown: el.classList.contains('ghc--shown') };
  };
  beforeEach(() => { Object.assign(window, { innerWidth: 1600, innerHeight: 1000 }); });
  it('under the block, at its start', () => {
    expect(place({ left: 400, top: 200, bottom: 240, right: 900 }, 700)).toEqual({ left: 400, top: 246, shown: true });
  });
  it('on a block wider than the card, never so far left that the pointer is past its right end', () => {
    expect(place({ left: 400, top: 200, bottom: 240, right: 1400 }, 1000).left).toBe(1000 - 360);
  });
  it('above the block when there is no room below, never under the title bar', () => {
    expect(place({ left: 400, top: 900, bottom: 940, right: 900 }, 700).top).toBe(900 - 6 - 120);
    expect(place({ left: 400, top: 100, bottom: 940, right: 900 }, 700).top).toBe(40);
  });
  it('kept inside the window at both sides', () => {
    expect(place({ left: 0, top: 200, bottom: 240, right: 100 }, 5).left).toBe(8);
    expect(place({ left: 1500, top: 200, bottom: 240, right: 1600 }, 1590).left).toBe(1600 - 360 - 8);
  });
});
