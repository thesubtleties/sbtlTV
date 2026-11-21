// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { StoredChannel, StoredProgram } from '../db';

let morph: (() => void) | undefined;
vi.mock('../hooks/useFavorites', () => ({ useIsFavoriteChannel: () => false, useToggleFavoriteChannel: () => () => {} }));
vi.mock('./ProgramLane', () => ({ ProgramLane: (p: { onMorph?: () => void }) => { morph = p.onMorph; return null; } }));
const { ChannelRow } = await import('./ChannelRow');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const at = (h: number, m: number) => new Date(2026, 10, 20, h, m);
const channel = { stream_id: 's1', name: 'Discovery', stream_icon: '', category_ids: [], source_id: 'src' } as unknown as StoredChannel;
const show: StoredProgram = { id: 'p1', stream_id: 's1', title: 'Show', description: '', start: at(20, 0), end: at(21, 0), source_id: 'src' };
let root: Root; let host: HTMLElement;
const render = (props: Partial<ComponentProps<typeof ChannelRow>>) => act(() => {
  root.render(createElement(ChannelRow, {
    channel, index: 0, sortOrder: 'alphabetical', channelColumnWidth: 300, programs: undefined, showNow: true,
    windowStart: at(20, 0), windowEnd: at(23, 0), now: at(20, 15), pixelsPerHour: 200, visibleHours: 3, onPlay: () => {},
    ...props,
  }));
});
const cell = () => host.querySelector('.guide-channel-now');
beforeEach(() => { host = document.createElement('div'); root = createRoot(host); morph = undefined; });
afterEach(() => { act(() => root.unmount()); });

describe('ChannelRow: the on-now line lands with its row', () => {
  it("grows in when the row's programs morph in (the morph started before the line showed)", () => {
    render({});
    act(() => morph?.());
    render({ programs: [show] });
    expect(cell()?.className).toContain('guide-channel-now--morph');
  });
  it('a line already showing when a morph starts stays as it is (no snap back to grow)', () => {
    render({ programs: [show] });
    act(() => morph?.());
    expect(cell()?.className).not.toContain('--morph');
  });
  it('fades in only when the show arrives after the row is on screen; a row rebuilt with its show shows it at once', () => {
    render({});
    render({ programs: [show] });
    expect(cell()?.className).not.toContain('--instant');
    act(() => root.unmount());
    root = createRoot(host);
    render({ programs: [show] });
    expect(cell()?.className).toContain('guide-channel-now--instant');
  });
  it('once grown, the class goes, so a later remount of the line just fades in', () => {
    render({});
    act(() => morph?.());
    render({ programs: [show] });
    act(() => { host.querySelector('.guide-channel-now-line > span')!.dispatchEvent(new Event('animationend', { bubbles: true })); });
    expect(cell()?.className).not.toContain('--morph');
  });
});

describe('ChannelRow: a cut-off channel name', () => {
  const name = () => host.querySelector('.guide-channel-name')!;
  const over = (px: number) => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200 + px);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
  };
  afterEach(() => vi.restoreAllMocks());
  it('fits: nothing special', () => {
    over(0); render({});
    expect(name().className).toBe('guide-channel-name');
  });
  it('over by a sliver: shown whole (clipped, no ellipsis) and it never slides', () => {
    over(5); render({});
    expect(name().className).toContain('--near-fit');
    expect(name().className).not.toContain('--overflow');
  });
  it('clearly cut off: an ellipsis at rest, and it slides by what is hidden while its row is hovered', () => {
    over(40); render({});
    expect(name().className).toContain('--overflow');
    expect((name() as HTMLElement).style.getPropertyValue('--marquee')).toBe('-46px');
  });
});

