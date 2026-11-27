/** What the shared data code needs from the system it runs on. Sized to what the code uses today. */
export type SqlScalar = null | number | bigint | string | Uint8Array;
export type SqlParam = SqlScalar | Record<string, SqlScalar>;
export interface Statement {
  get(...params: SqlParam[]): unknown;
  all(...params: SqlParam[]): unknown[];
  run(...params: SqlParam[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}
/** The shape of node:sqlite's DatabaseSync that the code uses; transactions are exec('BEGIN') / exec('COMMIT'). */
export interface Db { prepare(sql: string): Statement; exec(sql: string): void; close(): void }
export interface OpenDbOptions { readOnly: boolean; busyTimeoutMs: number }
export type Log = (message: string) => void;
export interface Files {
  join(...parts: string[]): string;
  dirname(p: string): string;
  basename(p: string): string;
  exists(p: string): boolean;
  list(dir: string): string[];
  /** Removes a file if present (never throws for a missing file). */
  remove(p: string): void;
  removeAsync(p: string): Promise<void>;
  size(p: string): number;
  /** The first `bytes` bytes (fewer if the file is shorter). */
  readHead(p: string, bytes: number): Uint8Array;
  /** The file as UTF-8 text, in chunks of about `chunkBytes`. */
  readText(p: string, chunkBytes: number): AsyncIterable<string>;
}
export interface Net {
  /** Streams a URL to `dest`: identity encoding, no-cache, LAN guard on every hop, at most 5 redirects, `maxBytes` cap
   * (error `${label} exceeds ${MB}MB limit`). On any failure `dest` is removed and the error rethrown. */
  downloadToFile(url: string, dest: string, opts: { maxBytes: number; allowLan: boolean; label: string }): Promise<{ status: number; bytes: number }>;
}
export interface Gunzip {
  /** Inflates `src` into `dest` with a `maxBytes` cap (same error text as Net). On failure `dest` is removed. */
  gunzipFile(src: string, dest: string, opts: { maxBytes: number; label: string }): Promise<void>;
}
export interface Platform { openDb(path: string, opts: OpenDbOptions): Db; files: Files; net: Net; gunzip: Gunzip; uuid(): string }
