// packages/mailbox/src/server/groups.test.ts
import { describe, expect, it } from 'vitest';
import { groupStoreContract } from './groups.contract.js';
import { MemoryGroupStore, dayMinus, utcDay } from './groups.js';

groupStoreContract('memory', async () => new MemoryGroupStore());

describe('days', () => {
  it('counts back across months and years', () => {
    expect(dayMinus('2026-03-01', 1)).toBe('2026-02-28');
    expect(dayMinus('2026-01-15', 90)).toBe('2025-10-17');
    expect(utcDay(Date.UTC(2026, 10, 16, 23, 59))).toBe('2026-11-16');
  });
});
