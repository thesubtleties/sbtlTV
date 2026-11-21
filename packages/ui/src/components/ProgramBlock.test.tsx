import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgramBlock } from './ProgramBlock';
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
  it('the show on now carries how much has aired (drawn brighter), in px from its left edge', () => {
    // Window from 21:00 at 200 px/h; the show runs 21:00-22:00; at 21:15, 50 px have aired
    const html = renderToStaticMarkup(createElement(ProgramBlock, {
      program, windowStart: at(21, 0), windowEnd: at(23, 0), now: at(21, 15), pixelsPerHour: 200,
    }));
    expect(html).toContain('--aired:50px');
    expect(render(at(22, 30))).not.toContain('--aired');
  });
  it('a show on now with only a sliver left in view drops its text', () => {
    // From 21:30 the show has 30 min left = 100 px: full block; from 21:50, 10 min = 33 px: a sliver
    expect(render(at(21, 40))).not.toContain('program-block--sliver');
    const sliver = renderToStaticMarkup(createElement(ProgramBlock, {
      program, windowStart: at(21, 50), windowEnd: at(23, 50), now: at(21, 50), pixelsPerHour: 200,
    }));
    expect(sliver).toContain('program-block--sliver');
  });
  it('lights up only the programmes a guide jump is for', () => {
    const lit = (ids: Set<string> | null) => renderToStaticMarkup(createElement(GuideHighlight.Provider, { value: ids },
      createElement(ProgramBlock, { program, windowStart: at(21, 30), windowEnd: at(23, 30), now: at(21, 40), pixelsPerHour: 200 })));
    expect(lit(new Set(['p1']))).toContain('program-block--found');
    expect(lit(new Set(['other']))).not.toContain('program-block--found');
    expect(lit(null)).not.toContain('program-block--found');
  });
});
