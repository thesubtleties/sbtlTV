// packages/mailbox/src/server/at-rest.ts
/**
 * Everything the relay stores is sealed once more with the relay's own key before it reaches the
 * database, and opened again only to be sent back. Computers' boxes are already end-to-end
 * encrypted; this makes sure nothing in the database, its snapshots or backups is in any form a
 * tool could open, whatever someone managed to upload. A downloader still gets back exactly the
 * bytes that were uploaded. Losing the key is the relay losing its data: the database is told the
 * key's id (pg-groups.ts migrate) and starts again with a new epoch, so computers put their boxes back.
 */
import { createHash } from 'node:crypto';
import { open, seal } from '../protocol/index.js';
import type { GroupStore, ListResult, Moved, RekeyEntry } from './groups.js';

/** The key's id as stored in the database (never the key) */
export const keyId = (key: Buffer) => createHash('sha256').update('sbtl-relay-at-rest-id').update(key).digest('hex').slice(0, 32);

const boxAad = (gid: string, did: string) => Buffer.from(`sbtl-relay-box|${gid}|${did}`);
const rekeyAad = (gid: string, did: string) => Buffer.from(`sbtl-relay-rekey|${gid}|${did}`);

export class AtRestGroupStore implements GroupStore {
  constructor(private inner: GroupStore, private key: Buffer) {
    if (key.length !== 32) throw new Error('the relay storage key must be 32 bytes');
  }

  private sealKeys(gid: string, keys: Map<string, RekeyEntry>): Map<string, RekeyEntry> {
    return new Map([...keys].map(([did, e]) => {
      const x = Buffer.isBuffer(e) ? { sealed: e, ackHash: null } : e;
      return [did, { sealed: seal(this.key, x.sealed, rekeyAad(gid, did)), ackHash: x.ackHash }];
    }));
  }

  group(gid: string) { return this.inner.group(gid); }

  putBox(gid: string, tokenHash: Buffer, did: string, sealed: Buffer, today: string, onlyReplace?: boolean) {
    return this.inner.putBox(gid, tokenHash, did, seal(this.key, sealed, boxAad(gid, did)), today, onlyReplace);
  }

  async list(gid: string, since: number, today: string): Promise<ListResult | Moved | null> {
    const l = await this.inner.list(gid, since, today);
    if (!l || 'moved' in l) return l;
    return { ...l, boxes: l.boxes.map((b) => ({ ...b, sealed: open(this.key, b.sealed, boxAad(gid, b.id)) })) };
  }

  deleteBox(gid: string, did: string) { return this.inner.deleteBox(gid, did); }
  rekey(gid: string, keys: Map<string, RekeyEntry>, today: string) { return this.inner.rekey(gid, this.sealKeys(gid, keys), today); }
  createRetired(gid: string, tokenHash: Buffer, keys: Map<string, RekeyEntry>, today: string) {
    return this.inner.createRetired(gid, tokenHash, this.sealKeys(gid, keys), today);
  }

  async getRekey(gid: string, did: string, today: string) {
    const sealed = await this.inner.getRekey(gid, did, today);
    return sealed && open(this.key, sealed, rekeyAad(gid, did));
  }

  ackRekey(gid: string, did: string, proof: Buffer, today: string) { return this.inner.ackRekey(gid, did, proof, today); }
  sweep(today: string) { return this.inner.sweep(today); }
  epoch() { return this.inner.epoch(); }
  sizeBytes() { return this.inner.sizeBytes(); }
  close() { return this.inner.close(); }
}
