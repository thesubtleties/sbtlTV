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
  it('lights up only the programmes a guide jump is for', () => {
    const lit = (ids: Set<string> | null) => renderToStaticMarkup(createElement(GuideHighlight.Provider, { value: ids },
      createElement(ProgramBlock, { program, windowStart: at(21, 30), windowEnd: at(23, 30), now: at(21, 40), pixelsPerHour: 200 })));
    expect(lit(new Set(['p1']))).toContain('program-block--found');
    expect(lit(new Set(['other']))).not.toContain('program-block--found');
    expect(lit(null)).not.toContain('program-block--found');
  });
});
