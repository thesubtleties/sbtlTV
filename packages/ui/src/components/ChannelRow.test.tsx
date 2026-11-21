import { describe, it, expect, vi } from 'vitest';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StoredChannel, StoredProgram } from '../db';

vi.mock('../hooks/useFavorites', () => ({ useIsFavoriteChannel: () => false, useToggleFavoriteChannel: () => () => {} }));
vi.mock('./ProgramLane', () => ({ ProgramLane: () => null }));
const { ChannelRow } = await import('./ChannelRow');

const at = (h: number, m: number) => new Date(2026, 10, 20, h, m);
const channel = { stream_id: 's1', name: 'Discovery', stream_icon: '', category_ids: [], source_id: 'src' } as unknown as StoredChannel;
const show: StoredProgram = { id: 'p1', stream_id: 's1', title: 'How the Universe Works', description: '', start: at(20, 0), end: at(21, 0), source_id: 'src' };
const row = (props: Partial<ComponentProps<typeof ChannelRow>>) => renderToStaticMarkup(createElement(ChannelRow, {
  channel, index: 0, sortOrder: 'alphabetical', channelColumnWidth: 300, programs: [show], showNow: true,
  windowStart: at(20, 0), windowEnd: at(23, 0), now: at(20, 15), pixelsPerHour: 200, visibleHours: 3, onPlay: () => {},
  ...props,
}));

describe('ChannelRow: what is on now, under the name', () => {
  it('the show on now and how far along it is; times are in the hover card, described for screen readers', () => {
    const html = row({});
    expect(html).toContain('guide-channel-now-title" dir="auto">How the Universe Works<');
    expect(html).toMatch(/guide-channel-now-line"[^>]*><span style="width:25%"/);
    expect(html).toContain('aria-description="On now, 45m left"');
    expect(html).not.toMatch(/guide-channel-now"[^>]*title=/);
  });
  it('comes from the live lookup when given, whatever time the grid shows', () => {
    const later: StoredProgram = { ...show, id: 'p2', title: 'Late Show', start: at(23, 0), end: at(24, 0) };
    const html = row({ programs: [later], windowStart: at(23, 0), nowProgram: show });
    expect(html).toContain('How the Universe Works');
    expect(html).not.toContain('Late Show');
  });
  it("a lookup answer that isn't current (a minute old) falls back to the row's programs: no blink", () => {
    const earlier: StoredProgram = { ...show, id: 'p0', title: 'Earlier Show', start: at(19, 0), end: at(20, 0) };
    const html = row({ nowProgram: earlier });
    expect(html).toContain('How the Universe Works');
    expect(html).not.toContain('Earlier Show');
  });
  it('no EPG, nothing on now, or the setting off: just the name', () => {
    for (const html of [row({ programs: [] }), row({ now: at(21, 30) }), row({ showNow: false })]) {
      expect(html).toContain('>Discovery<');
      expect(html).not.toContain('guide-channel-now');
    }
  });
});
