// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { StoredProgram } from '../db';

let answer: { data?: StoredProgram[]; stale: boolean } = { stale: true };
const requests: unknown[] = [];
vi.mock('../data/useDataQuery', () => ({ useDataQuery: (req: unknown) => { requests.push(req); return answer; } }));
const { usePrograms } = await import('./useChannels');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const at = (h: number, m: number) => new Date(2026, 10, 20, h, m);
const prog = (id: string, stream: string, s: Date, e: Date): StoredProgram => ({ id, stream_id: stream, source_id: 'x', title: id, description: '', start: s, end: e });
let root: Root; let host: HTMLElement; let seen: ReadonlyMap<string, StoredProgram | null>[] = [];
const Probe = ({ ids }: { ids: string[] }) => { seen.push(usePrograms(ids, at(20, 15))); return null; };
const render = (ids: string[]) => act(() => { root.render(createElement(Probe, { ids })); });
beforeEach(() => { host = document.createElement('div'); root = createRoot(host); seen = []; requests.length = 0; });
afterEach(() => { act(() => root.unmount()); });

describe("usePrograms: what's on now for the guide's rows", () => {
  it('a fresh answer: the show on now per row, null for none; a show that ended at now is not on', () => {
    answer = { stale: false, data: [prog('a1', 'a', at(20, 0), at(21, 0)), prog('b0', 'b', at(19, 0), at(20, 15))] };
    render(['a', 'b']);
    const m = seen[seen.length - 1]!;
    expect(m.get('a')?.id).toBe('a1');
    expect(m.get('b')).toBeNull();
  });
  it('while the next answer is read, the last one stays (same map): cells keep their show', () => {
    answer = { stale: false, data: [prog('a1', 'a', at(20, 0), at(21, 0))] };
    render(['a']);
    const first = seen[seen.length - 1];
    answer = { stale: true, data: undefined };
    render(['a', 'c']);
    expect(seen[seen.length - 1]).toBe(first);
  });
  it('no ids (the setting off, or the grid already covers now): no query at all', () => {
    render([]);
    expect(requests[requests.length - 1]).toBeNull();
  });
});
