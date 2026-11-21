// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('./MediaCard', () => ({ MediaCard: () => createElement('div', { className: 'media-card' }) }));
vi.mock('./MissingCard', () => ({ MissingCard: () => null }));
const { ContinueWatchingRow } = await import('./ContinueWatchingRow');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement;
const size = (scrollWidth: number, clientWidth: number) => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth);
};
const items = Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, kind: 'movie', media: {}, resumePct: 10, subtitle: '' })) as never;
const render = () => act(() => { root.render(createElement(ContinueWatchingRow, { items, onPlay: () => {}, onRemove: () => {} })); });
const right = () => host.querySelector<HTMLButtonElement>('button[aria-label="Scroll right"]');
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe('Continue Watching scrolls without a trackpad', () => {
  it('more posters than fit: the › button works and the right edge fades', () => {
    size(2000, 800);
    render();
    expect(right()?.disabled).toBe(false);
    expect(host.querySelector('.carousel__fade--right')).not.toBeNull();
    const scrollTo = vi.fn();
    (host.querySelector('.carousel__scroll-container') as HTMLElement).scrollTo = scrollTo;
    act(() => right()!.click());
    expect(scrollTo).toHaveBeenCalledWith({ left: 600, behavior: 'smooth' });
  });
  it('everything fits: the buttons are there but greyed, no fades', () => {
    size(800, 800);
    render();
    expect(right()?.disabled).toBe(true);
    expect(host.querySelector('.carousel__fade')).toBeNull();
  });
});
