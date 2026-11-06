import { describe, it, expect } from 'vitest';
import { onceEachStatus } from './dataStatus';

describe('onceEachStatus', () => {
  it('tells once, when the startup check and the event both report it', () => {
    const told: string[] = [];
    const show = onceEachStatus((s) => told.push(s));
    show('reset');
    show('reset');
    expect(told).toEqual(['reset']);
  });
  it('still tells a different status, and ignores none', () => {
    const told: string[] = [];
    const show = onceEachStatus((s) => told.push(s));
    show(null);
    show('reset');
    show('fatal');
    expect(told).toEqual(['reset', 'fatal']);
  });
});
