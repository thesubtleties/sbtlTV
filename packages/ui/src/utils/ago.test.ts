import { describe, expect, it } from 'vitest';
import { ago } from './ago';

const now = Date.UTC(2026, 10, 16, 12);
describe('ago', () => {
  it('says how long ago, plainly', () => {
    expect(ago(now - 20_000, now)).toBe('just now');
    expect(ago(now - 60_000, now)).toBe('1 minute ago');
    expect(ago(now - 2 * 60_000, now)).toBe('2 minutes ago');
    expect(ago(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(ago(now - 3 * 86_400_000, now)).toBe('3 days ago');
    expect(ago(now - 86_400_000, now)).toBe('1 day ago');
  });
});
