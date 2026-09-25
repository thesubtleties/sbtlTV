import { describe, it, expect } from 'vitest';
import { groupProgramsByStream } from './useChannels';

describe('groupProgramsByStream', () => {
  it('seeds every requested id with an empty list and groups rows in order', () => {
    const rows = [
      { id: 'b1', stream_id: 'b', title: 'B1', description: '', start: new Date(2), end: new Date(3), source_id: 's' },
      { id: 'a1', stream_id: 'a', title: 'A1', description: '', start: new Date(1), end: new Date(2), source_id: 's' },
    ];
    const m = groupProgramsByStream(['a', 'b', 'c'], rows);
    expect([...m.keys()]).toEqual(['a', 'b', 'c']);
    expect(m.get('c')).toEqual([]);
    expect(m.get('b')?.map((p) => p.id)).toEqual(['b1']);
  });
});
