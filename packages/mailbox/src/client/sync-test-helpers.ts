// packages/mailbox/src/client/sync-test-helpers.ts
import type { Sealer } from './sync-store.js';
/** A stand-in keyring for tests: reversible, and switchable off. */
export const fakeSealer = (on = true): Sealer => ({
  available: () => on,
  seal: (s) => `S:${Buffer.from(s).toString('base64')}`,
  open: (s) => { if (!s.startsWith('S:')) throw new Error('not sealed here'); return Buffer.from(s.slice(2), 'base64').toString(); },
});
