// packages/mailbox/src/client/sync-store.ts
/**
 * This computer's sync state, in one file next to its settings. The group key and the computer's
 * private key are sealed by the OS keyring (Sealer); without one, sync doesn't start. Everything
 * else (own records, other computers' last boxes) is plain: the same data the app already keeps.
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { SyncRecord } from '@sbtltv/core';
import { exportPrivate, keyPairFromPrivate, type KeyPair } from '../protocol/index.js';

export interface Sealer { available(): boolean; seal(plain: string): string; open(sealed: string): string }
export class KeyringUnavailable extends Error { constructor() { super('keyring unavailable'); } }

export type Parts = { watchlist: boolean; progress: boolean; settings: boolean };
export const DEFAULT_PARTS: Parts = { watchlist: true, progress: true, settings: false };
export type SyncStatus = 'pending' | 'active' | 'removed' | 'ended';
export interface OtherComputer { name: string; pub: string; counter: number; seq: number; records: SyncRecord[]; seenAt: number }
/**
 * A group this computer moved away from (Amendment A). It keeps checking it until every remaining
 * computer has its new key. The remover also knows who it removed and the new key, so it can move a
 * rebuilt old group again without them.
 */
export interface PreviousGroup {
  key: string;          // sealed old group key
  removed: string[];    // computers removed at that move (empty when this computer only followed it)
  at: number;           // when this computer moved away
  /** The remover only: the computers that stayed (id -> public key), for moving a rebuilt old group again */
  members?: Record<string, string>;
  /** The remover only: their names, to say which to add again if someone else took the old group */
  names?: Record<string, string>;
  /** The remover only: the relay database (epoch) in which this computer last put the retired marker */
  markedIn?: string | null;
}
export interface SyncFile {
  v: 1; status: SyncStatus;
  key: string; device: string;
  deviceId: string; pub: string; name: string;
  counter: number; parts: Parts;
  own: SyncRecord[];
  others: Record<string, OtherComputer>;
  since: number; lastSync: number | null; pendingUntil: number | null;
  applied: Record<string, number>;
  /** The relay database's id when this computer last reached its group (null = not known yet) */
  epoch: string | null;
  previous: PreviousGroup[];
  /** Computers to add again: an old group was retired by someone else after the relay lost its data */
  interrupted: string[];
}

const STATUSES = new Set(['pending', 'active', 'removed', 'ended']);
const looksRight = (f: Partial<SyncFile> | null): f is SyncFile =>
  !!f && f.v === 1 && STATUSES.has(f.status as string) && typeof f.key === 'string' && typeof f.device === 'string'
  && typeof f.deviceId === 'string' && /^[0-9a-f]{32}$/.test(f.deviceId) && typeof f.name === 'string'
  && Number.isSafeInteger(f.counter) && Array.isArray(f.own) && !!f.others && typeof f.others === 'object'
  && Number.isSafeInteger(f.since) && !!f.parts && !!f.applied;

export class SyncStore {
  constructor(private file: string, private sealer: Sealer) {}

  load(): SyncFile | null {
    if (!existsSync(this.file)) return null;
    try {
      const f = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<SyncFile> | null;
      if (looksRight(f)) return { ...f, epoch: typeof f.epoch === 'string' ? f.epoch : null, previous: Array.isArray(f.previous) ? f.previous : [], interrupted: Array.isArray(f.interrupted) ? f.interrupted : [] };
    } catch { /* below */ }
    renameSync(this.file, `${this.file}.bad`);
    return null;
  }

  save(f: SyncFile): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(f), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  clear(): void { rmSync(this.file, { force: true }); }

  seal(K: Buffer, device: KeyPair): { key: string; device: string } {
    if (!this.sealer.available()) throw new KeyringUnavailable();
    return { key: this.sealer.seal(K.toString('base64')), device: this.sealer.seal(exportPrivate(device).toString('base64')) };
  }

  open(f: SyncFile): { K: Buffer; device: KeyPair } {
    if (!this.sealer.available()) throw new KeyringUnavailable();
    try {
      const K = Buffer.from(this.sealer.open(f.key), 'base64');
      if (K.length !== 32) throw new Error('bad key');
      return { K, device: keyPairFromPrivate(Buffer.from(this.sealer.open(f.device), 'base64')) };
    } catch {
      throw new KeyringUnavailable();
    }
  }
}
