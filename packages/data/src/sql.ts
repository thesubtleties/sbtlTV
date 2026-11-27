import type { Db } from './platform.js';

// Rolls back the open transaction. SQLite has sometimes rolled back already (a full disk does), and then `rollback`
// itself throws "no transaction is active", which would hide the real error: the caller rethrows that one.
export function rollbackQuietly(db: Db): void {
  try { db.exec('rollback'); } catch { /* already rolled back */ }
}
