// packages/mailbox/src/client/sync.ts
/** Sync's side of the relay: one sealed box per computer in a group the relay can't read. */
import { MAX_BOX_BYTES, MAX_COMPUTERS, decodeB64, type EpochRes, type ListRes, type PutBoxRes, type RekeyRes } from '../protocol/index.js';
import { MailboxError, type Transport } from './transport.js';

/** Biggest list reply: every computer's box as base64 inside JSON. */
const MAX_LIST_CHARS = Math.ceil(MAX_COMPUTERS * MAX_BOX_BYTES * 4 / 3) + 64 * 1024;
const notFound = (e: unknown) => e instanceof MailboxError && e.code === 'not-found';

export class SyncClient {
  constructor(private t: Transport, private groupId: string) {}
  private path(rest: string) { return `/v1/groups/${this.groupId}${rest}`; }

  async push(deviceId: string, sealed: Buffer): Promise<number> {
    const res = await this.t.post<PutBoxRes>(this.path(`/boxes/${deviceId}`), { sealed: sealed.toString('base64') }, true, 'PUT');
    if (!res || !Number.isSafeInteger(res.seq)) throw new MailboxError('bad-request');
    return res.seq;
  }

  async list(since: number) {
    let res: ListRes;
    try { res = await this.t.get<ListRes>(this.path(`/boxes?since=${since}`), MAX_LIST_CHARS); } catch (e) { if (notFound(e)) return null; throw e; }
    if ('moved' in res && res.moved) return { moved: true as const, waiting: Number(res.waiting) || 0 };
    const l = res as Extract<ListRes, { seq: number }>;
    return {
      moved: false as const, seq: l.seq,
      computers: l.computers.map((c) => ({ id: String(c.id), seq: Number(c.seq) })),
      boxes: l.boxes.map((b) => ({ id: String(b.id), seq: Number(b.seq), sealed: decodeB64(b.sealed) })),
    };
  }

  async leave(deviceId: string): Promise<void> {
    try { await this.t.del(this.path(`/boxes/${deviceId}`)); } catch (e) { if (!notFound(e)) throw e; }
  }

  async rekey(keys: Map<string, Buffer>): Promise<void> {
    await this.t.post(this.path('/rekey'), { keys: Object.fromEntries([...keys].map(([d, s]) => [d, s.toString('base64')])) }, true);
  }

  /** The relay database's id (see the sync engine: "deleted" vs "the relay lost its data"). */
  async epoch(): Promise<string> {
    const r = await this.t.get<EpochRes>('/v1/sync/epoch');
    if (typeof r.epoch !== 'string' || !/^[0-9a-f]{32}$/.test(r.epoch)) throw new MailboxError('bad-request');
    return r.epoch;
  }

  async fetchRekey(deviceId: string): Promise<Buffer | null> {
    try { return decodeB64((await this.t.get<RekeyRes>(this.path(`/rekey/${deviceId}`))).sealed); } catch (e) { if (notFound(e)) return null; throw e; }
  }
}
