import { describe, it, expect } from 'vitest';
import { isDataRequest, isDataEvent } from './data-protocol';

describe('data protocol guards', () => {
  it('accepts a well-formed request envelope', () => {
    expect(isDataRequest({ id: 1, type: 'categories', sourceIds: [] })).toBe(true);
  });
  it('rejects envelopes without a numeric id or a string type', () => {
    expect(isDataRequest({ type: 'categories' })).toBe(false);
    expect(isDataRequest({ id: 'x', type: 'categories' })).toBe(false);
    expect(isDataRequest(null)).toBe(false);
  });
  it('recognises change events', () => {
    expect(isDataEvent({ kind: 'changed', table: 'channels', sourceId: 's1' })).toBe(true);
    expect(isDataEvent({ kind: 'nope' })).toBe(false);
  });
});
