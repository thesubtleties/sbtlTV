import { describe, expect, it } from 'vitest';
import { onNow } from './onNow';
import type { StoredProgram } from '../db';

const at = (h: number, m: number) => new Date(2026, 10, 20, h, m);
const show = { id: 'p', stream_id: 's', source_id: 'src', title: 'Shark Tank', description: '', start: at(20, 0), end: at(21, 0) } as StoredProgram;

describe('what a guide row shows under its channel name', () => {
  it('the show on now and how far along it is', () => {
    expect(onNow(show, at(20, 15))).toEqual({ program: show, pct: 25 });
    expect(onNow(show, at(20, 0))?.pct).toBe(0);
  });
  it('nothing when no show, before it starts, from its end on, or with no length', () => {
    expect(onNow(null, at(20, 15))).toBeNull();
    expect(onNow(undefined, at(20, 15))).toBeNull();
    expect(onNow(show, at(19, 59))).toBeNull();
    expect(onNow(show, at(21, 0))).toBeNull();
    expect(onNow({ ...show, end: at(20, 0) }, at(20, 0))).toBeNull();
  });
});
