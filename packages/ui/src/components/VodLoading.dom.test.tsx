// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { VodLoading, playbackStarted } from './VodLoading';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(props: Parameters<typeof VodLoading>[0]) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(VodLoading, props)));
  return { host, done: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe('VodLoading', () => {
  it('shows the title, the episode line and the art (blurred by CSS); a live region says what is loading', async () => {
    const { host, done } = await mount({ title: 'Severance', detail: 'S2 E3 · Who Is Alive?', art: 'https://img/x.jpg', onCancel: () => {} });
    expect(host.querySelector('.vod-loading__title')?.textContent).toBe('Severance');
    expect(host.querySelector('.vod-loading__detail')?.textContent).toBe('S2 E3 · Who Is Alive?');
    expect(host.querySelector<HTMLImageElement>('.vod-loading__art')?.getAttribute('src')).toBe('https://img/x.jpg');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading Severance');
    expect(host.querySelector('.sbtl-loader--slow')).not.toBeNull();
    await done();
  });

  it('no art: no image (plain background), no episode line for a movie', async () => {
    const { host, done } = await mount({ title: 'Heat', onCancel: () => {} });
    expect(host.querySelector('.vod-loading__art')).toBeNull();
    expect(host.querySelector('.vod-loading__detail')).toBeNull();
    await done();
  });

  it('art that fails to load is dropped rather than shown broken', async () => {
    const { host, done } = await mount({ title: 'Heat', art: 'https://img/missing.jpg', onCancel: () => {} });
    await act(async () => { host.querySelector('.vod-loading__art')!.dispatchEvent(new Event('error')); });
    expect(host.querySelector('.vod-loading__art')).toBeNull();
    await done();
  });

  it('Cancel and Escape cancel; Escape goes no further (the Movies page under it does not also go back)', async () => {
    const onCancel = vi.fn();
    const below = vi.fn();
    window.addEventListener('keydown', below);
    const { host, done } = await mount({ title: 'Heat', onCancel });
    await act(async () => { host.querySelector<HTMLButtonElement>('.vod-loading__cancel')!.click(); });
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(below).not.toHaveBeenCalled();
    // Other keys pass through
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); });
    expect(below).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', below);
    await done();
  });
});

describe('playbackStarted', () => {
  it('when the position moves on a little between two updates: playing, not a seek landing (an open file can still buffer)', () => {
    expect(playbackStarted(null, 5)).toBe(false);       // no update since the file opened yet
    expect(playbackStarted(0, 0)).toBe(false);          // buffering: standing still
    expect(playbackStarted(0, 1200)).toBe(false);       // the resume seek landing, nothing played yet
    expect(playbackStarted(1200, 1200)).toBe(false);
    expect(playbackStarted(1200, 1200.25)).toBe(true);  // playing
    expect(playbackStarted(0, 0.25)).toBe(true);
    expect(playbackStarted(10, 9)).toBe(false);         // backwards: a seek
  });
});
