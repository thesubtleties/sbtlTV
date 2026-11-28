import { openDatabaseSync, type SQLiteDatabase, type SQLiteStatement } from 'expo-sqlite';
import type { Db, OpenDbOptions, RunResult, SqlNamed, SqlScalar, Statement } from '@sbtltv/data';

type Params = (SqlScalar | SqlNamed)[];
// node:sqlite takes positional values or one object of $named values first; expo-sqlite takes an array or an object.
function bind(params: Params): SqlScalar[] | SqlNamed {
  if (params.length > 0 && params[0] !== null && typeof params[0] === 'object' && !(params[0] instanceof Uint8Array)) {
    if (params.length > 1) throw new Error('named and positional parameters together are not supported');
    return params[0] as SqlNamed;
  }
  return params as SqlScalar[];
}

class RnStatement implements Statement {
  constructor(private st: SQLiteStatement) {}
  get(...p: Params): unknown { const r = this.st.executeSync(bind(p) as never); try { return r.getFirstSync() ?? undefined; } finally { r.resetSync(); } }
  all(...p: Params): unknown[] { const r = this.st.executeSync(bind(p) as never); try { return r.getAllSync(); } finally { r.resetSync(); } }
  run(...p: Params): RunResult { const r = this.st.executeSync(bind(p) as never); const out = { changes: r.changes, lastInsertRowid: r.lastInsertRowId }; r.resetSync(); return out; }
  finalize(): void { this.st.finalizeSync(); }
}

class RnDb implements Db {
  private statements: RnStatement[] = [];
  constructor(private db: SQLiteDatabase) {}
  prepare(sql: string): Statement { const s = new RnStatement(this.db.prepareSync(sql)); this.statements.push(s); return s; }
  exec(sql: string): void { this.db.execSync(sql); }
  close(): void { for (const s of this.statements) { try { s.finalize(); } catch { /* already finalized */ } } this.db.closeSync(); }
}

export function openRnDb(path: string, opts: OpenDbOptions): Db {
  const slash = path.lastIndexOf('/');
  // Its own connection every time (expo-sqlite shares one per file by default): the reader's query_only and the
  // writers' transactions must not leak into each other, as with node:sqlite's separate connections on desktop.
  const db = openDatabaseSync(path.slice(slash + 1), { useNewConnection: true }, path.slice(0, slash));
  db.execSync(`pragma busy_timeout = ${opts.busyTimeoutMs}`);
  db.execSync('pragma temp_store = file');   // sorts, index builds and scratch files on disk, never RAM (spec)
  if (opts.readOnly) db.execSync('pragma query_only = 1');
  return new RnDb(db);
}
