import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgramBlock, airedPx, isProgramEnded, isSliver } from './ProgramBlock';
import { GuideHighlight } from './GuideSearchResults';
import type { StoredProgram } from '../db';

const at = (h: number, m: number) => new Date(2026, 9, 17, h, m);
const program: StoredProgram = {
  id: 'p1', stream_id: 's1', title: 'News', description: '', start: at(21, 0), end: at(22, 0), source_id: 'src',
};
const render = (now: Date) =>
  renderToStaticMarkup(createElement(ProgramBlock, {
    program, windowStart: at(21, 30), windowEnd: at(23, 30), now, pixelsPerHour: 200,
  }));

describe('ProgramBlock', () => {
  it("is highlighted while on now, by the guide's tick rather than the wall clock", () => {
    expect(render(at(21, 59))).toMatch(/class="program-block current/);
    expect(render(at(22, 0))).not.toMatch(/\bcurrent\b/);
  });
  it('a show that already ended is marked ended (an outline, not upcoming), by the guide\'s tick', () => {
    expect(isProgramEnded(program, at(21, 59))).toBe(false);
    expect(isProgramEnded(program, at(22, 0))).toBe(true);
    // The 21:00-22:00 show in a grid from 21:30, seen at 22:10: ended, not on now
    expect(render(at(22, 10))).toMatch(/class="program-block +program-block--ended"/);
    expect(render(at(21, 45))).not.toContain('program-block--ended');
  });
  it('the show on now carries how much has aired (drawn brighter), in px from its left edge', () => {
    // Window from 21:00 at 200 px/h; the show runs 21:00-22:00; at 21:15, 50 px have aired
    const html = renderToStaticMarkup(createElement(ProgramBlock, {
      program, windowStart: at(21, 0), windowEnd: at(23, 0), now: at(21, 15), pixelsPerHour: 200,
    }));
    expect(html).toContain('--aired:50px');
    expect(render(at(22, 30))).not.toContain('--aired');
  });
  it('a show on now cut off at the left with little left in view is a sliver; a short show starting in view is not', () => {
    // Window from 21:50 at 200 px/h: the 21:00-22:00 show has 10 min in view (33 px) and started before the edge
    expect(isSliver(program, 33, at(21, 50), at(21, 50))).toBe(true);
    // A 15-minute show starting in view at 48 px keeps its text
    const short = { ...program, start: at(22, 0), end: at(22, 15) };
    expect(isSliver(short, 48, at(22, 5), at(21, 30))).toBe(false);
    // Not on now: never
    expect(isSliver(program, 33, at(22, 30), at(21, 50))).toBe(false);
    const html = renderToStaticMarkup(createElement(ProgramBlock, {
      program, windowStart: at(21, 50), windowEnd: at(23, 50), now: at(21, 50), pixelsPerHour: 200,
    }));
    expect(html).toContain('program-block--sliver');
  });
  it('the aired width: from the block to now, never below 0 or past the block', () => {
    expect(airedPx(100, 200, at(21, 30), at(21, 0), 200)).toBe(0);    // now (x 100) at the block's start
    expect(airedPx(0, 200, at(21, 30), at(21, 0), 200)).toBe(100);   // block cut at the left: aired = now's x
    expect(airedPx(150, 200, at(21, 30), at(21, 0), 200)).toBe(0);   // now before the block
    expect(airedPx(0, 50, at(21, 30), at(21, 0), 200)).toBe(50);     // now past the block
  });
  it('the times and description are there for screen readers', () => {
    expect(render(at(21, 40))).toMatch(/aria-description="[^"]*–[^"]*"/);
  });
  it('lights up only the programmes a guide jump is for', () => {
    const lit = (ids: Set<string> | null) => renderToStaticMarkup(createElement(GuideHighlight.Provider, { value: ids },
      createElement(ProgramBlock, { program, windowStart: at(21, 30), windowEnd: at(23, 30), now: at(21, 40), pixelsPerHour: 200 })));
    expect(lit(new Set(['p1']))).toContain('program-block--found');
    expect(lit(new Set(['other']))).not.toContain('program-block--found');
    expect(lit(null)).not.toContain('program-block--found');
  });
});
