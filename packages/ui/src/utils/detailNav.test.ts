import { describe, it, expect } from 'vitest';
import { detailNav, MAX_TRAIL, type DetailNav, type DetailNavAction } from './detailNav';

const run = (actions: DetailNavAction<string>[], from: DetailNav<string> = { current: null, trail: [] }) => actions.reduce(detailNav<string>, from);

describe('detail navigation', () => {
  it('More like this builds a trail; Back walks it; at the start Back leaves', () => {
    let s = run([{ type: 'open', item: 'Odyssey' }, { type: 'openRelated', item: 'Troy' }, { type: 'openRelated', item: 'Gladiator' }]);
    expect(s).toEqual({ current: 'Gladiator', trail: ['Odyssey', 'Troy'] });
    s = run([{ type: 'back' }], s);
    expect(s).toEqual({ current: 'Troy', trail: ['Odyssey'] });
    s = run([{ type: 'back' }, { type: 'back' }], s);
    expect(s).toEqual({ current: null, trail: [] });
  });

  it('Home leaves from any depth and forgets the trail', () => {
    expect(run([{ type: 'open', item: 'A' }, { type: 'openRelated', item: 'B' }, { type: 'home' }])).toEqual({ current: null, trail: [] });
  });

  it('opening from anywhere else starts fresh (hero, category, Continue Watching)', () => {
    expect(run([{ type: 'open', item: 'A' }, { type: 'openRelated', item: 'B' }, { type: 'open', item: 'C' }])).toEqual({ current: 'C', trail: [] });
  });

  it('a related title with nothing open just opens; revisiting a title keeps the trail honest', () => {
    expect(run([{ type: 'openRelated', item: 'A' }])).toEqual({ current: 'A', trail: [] });
    const s = run([{ type: 'open', item: 'A' }, { type: 'openRelated', item: 'B' }, { type: 'openRelated', item: 'A' }, { type: 'back' }]);
    expect(s).toEqual({ current: 'B', trail: ['A'] });
  });

  it('the trail is capped, and Home with nothing open changes nothing', () => {
    const many = Array.from({ length: MAX_TRAIL + 10 }, (_, i) => ({ type: 'openRelated' as const, item: `t${i}` }));
    expect(run([{ type: 'open', item: 'start' }, ...many]).trail).toHaveLength(MAX_TRAIL);
    const empty: DetailNav<string> = { current: null, trail: [] };
    expect(detailNav(empty, { type: 'home' })).toBe(empty);
  });
});
