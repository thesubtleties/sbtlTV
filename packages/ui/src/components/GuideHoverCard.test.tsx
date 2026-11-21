import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuideHoverCard } from './GuideHoverCard';
import type { StoredProgram } from '../db';

const at = (h: number, m: number) => new Date(2026, 10, 20, h, m);
const show: StoredProgram = { id: 'p', stream_id: 's', title: 'Shark Tank', description: 'A portable product for beach hangs.', start: at(20, 0), end: at(21, 30), source_id: 'src' };
const card = (now: Date) =>
  renderToStaticMarkup(createElement(GuideHoverCard, { program: show, anchor: { left: 10, top: 10, right: 110, bottom: 50, width: 100, height: 40, x: 10, y: 10, toJSON: () => ({}) } as DOMRect, now }));

describe('the guide hover card', () => {
  it('a show on now: title, one line of when (times, length, time left), description, progress on the edge', () => {
    const html = card(at(20, 45));
    expect(html).toContain('Shark Tank');
    expect(html).toContain('1h 30m');
    expect(html).toContain('45m left');
    expect(html).toContain('ghc--now');
    expect(html).toContain('--progress:50%');
    expect(html).toContain('A portable product for beach hangs.');
    expect(html).toContain('role="tooltip"');
  });
  it("names the day only when a show is hours away, not for one just past midnight", () => {
    const late = (start: Date, end: Date, now: Date) => renderToStaticMarkup(createElement(GuideHoverCard, {
      program: { ...show, start, end }, anchor: { left: 10, top: 10, right: 110, bottom: 50, width: 100, height: 40, x: 10, y: 10, toJSON: () => ({}) } as DOMRect, now,
    }));
    expect(late(new Date(2026, 10, 21, 0, 0), new Date(2026, 10, 21, 1, 0), at(23, 34))).not.toContain('Tomorrow');
    expect(late(new Date(2026, 10, 21, 20, 0), new Date(2026, 10, 21, 21, 0), at(20, 0))).toContain('Tomorrow');
  });
  it('a later show says when it starts; one that ended says so; neither carries progress', () => {
    expect(card(at(19, 35))).toContain('in 25m');
    expect(card(at(19, 35))).not.toContain('ghc--now');
    expect(card(at(22, 0))).toContain('Ended');
  });
});
