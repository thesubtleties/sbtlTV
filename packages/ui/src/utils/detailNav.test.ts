import { describe, it, expect } from 'vitest';
import { detailNav, isBackKey, MAX_TRAIL, seriesSeasonKey, type DetailNav, type DetailNavAction } from './detailNav';

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

describe('detail navigation: long chains and state', () => {
  it('the cap drops the oldest titles: Back still returns to the one just left', () => {
    const many = Array.from({ length: MAX_TRAIL + 10 }, (_, i) => ({ type: 'openRelated' as const, item: `t${i}` }));
    const s = run([{ type: 'open', item: 'start' }, ...many]);
    expect(s.current).toBe(`t${MAX_TRAIL + 9}`);
    expect(s.trail[s.trail.length - 1]).toBe(`t${MAX_TRAIL + 8}`);
    expect(s.trail).not.toContain('start');
    expect(run([{ type: 'back' }], s).current).toBe(`t${MAX_TRAIL + 8}`);
  });

  it('never changes the state it was given (React keeps the old one for the store sync)', () => {
    const frozen: DetailNav<string> = Object.freeze({ current: 'B', trail: Object.freeze(['A']) as string[] });
    expect(() => run([{ type: 'openRelated', item: 'C' }, { type: 'back' }, { type: 'back' }, { type: 'back' }], frozen)).not.toThrow();
    expect(() => detailNav(frozen, { type: 'back' })).not.toThrow();
    expect(frozen).toEqual({ current: 'B', trail: ['A'] });
  });
});

describe('back keys', () => {
  const k = (key: string, mods: Partial<Record<'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey', boolean>> = {}) =>
    ({ key, altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, ...mods });
  it('Alt+Left, Cmd+[ and the Back key; nothing else', () => {
    expect(isBackKey(k('ArrowLeft', { altKey: true }), false)).toBe(true);
    expect(isBackKey(k('[', { metaKey: true }), false)).toBe(true);
    expect(isBackKey(k('BrowserBack'), false)).toBe(true);
    expect(isBackKey(k('ArrowLeft'), false)).toBe(false); // plain arrows move in rows
    expect(isBackKey(k('ArrowLeft', { altKey: true, shiftKey: true }), false)).toBe(false);
    expect(isBackKey(k('[', { ctrlKey: true }), false)).toBe(false);
  });
  it('not while typing, except the dedicated Back key', () => {
    expect(isBackKey(k('ArrowLeft', { altKey: true }), true)).toBe(false);
    expect(isBackKey(k('[', { metaKey: true }), true)).toBe(false);
    expect(isBackKey(k('BrowserBack'), true)).toBe(true);
  });
});

describe('seriesSeasonKey', () => {
  it('tmdb id when known, else the series id', () => {
    expect(seriesSeasonKey({ tmdb_id: 42, series_id: 's1' })).toBe('42');
    expect(seriesSeasonKey({ series_id: 's1' })).toBe('s1');
  });
});
