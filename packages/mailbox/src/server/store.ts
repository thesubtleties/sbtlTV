/** Knocks in memory. One replica; a restart loses knocks in flight, which users simply start again. */
import { randomBytes } from 'node:crypto';
import { DROP_TTL_MS, KNOCK_TTL_MS, newCode, type KnockStatus } from '../protocol/index.js';

export interface Knock {
  id: string; ticket: string | null; code: string; commitment: string;
  giverKey?: string; receiverKey?: string; r?: string; sealed?: string;
  status: KnockStatus; expiresAt: number;
}

/** How long a finished knock (picked up / cancelled) stays visible to the giver's poll. */
const TOMBSTONE_MS = 60_000;

export class KnockStore {
  private byId = new Map<string, Knock>();
  private byCode = new Map<string, Knock>();
  private byTicket = new Map<string, Knock>();
  /** Bytes of sealed drops held right now (base64 length), kept under maxStoredBytes. */
  private storedBytes = 0;
  constructor(private now: () => number, private maxActive = 50_000, maxStoredBytes: number | (() => number) = 256 * 1024 * 1024) {
    this.maxStoredBytes = typeof maxStoredBytes === 'function' ? maxStoredBytes : () => maxStoredBytes;
  }
  private maxStoredBytes: () => number;

  create(commitment: string): Knock | null {
    this.sweep();
    if (this.byId.size >= this.maxActive) return null;
    let code = newCode();
    while (this.byCode.has(code)) code = newCode();
    const k: Knock = { id: randomBytes(16).toString('hex'), ticket: null, code, commitment, status: 'waiting', expiresAt: this.now() + KNOCK_TTL_MS };
    this.byId.set(k.id, k); this.byCode.set(code, k);
    return k;
  }

  private live(k: Knock | undefined): Knock | undefined {
    if (!k) return undefined;
    if (k.expiresAt <= this.now()) { this.remove(k); return undefined; }
    return k;
  }

  byIdLive(id: string) { return this.live(this.byId.get(id)); }
  byCodeLive(code: string) { return this.live(this.byCode.get(code)); }
  byTicketLive(ticket: string) { return this.live(this.byTicket.get(ticket)); }

  /** The code is used: from now on only the ticket reaches this knock. */
  claim(k: Knock): string {
    k.ticket = randomBytes(16).toString('hex');
    k.status = 'claimed';
    this.byTicket.set(k.ticket, k);
    this.byCode.delete(k.code);            // a code rings once
    return k.ticket;
  }

  setGiverKey(k: Knock, giverKey: string): boolean {
    if (k.status !== 'claimed') return false;
    k.giverKey = giverKey; k.status = 'rung';
    return true;
  }

  /** 'busy' = no room right now (memory budget); 'gone' = not waiting for a drop any more. */
  drop(k: Knock, sealed: string): 'ok' | 'busy' | 'gone' {
    this.sweep();
    if (k.status !== 'revealed') return 'gone';   // checked again here: two drops may race
    if (this.storedBytes + sealed.length > this.maxStoredBytes()) return 'busy';
    this.storedBytes += sealed.length;
    k.sealed = sealed; k.status = 'dropped'; k.expiresAt = this.now() + DROP_TTL_MS;
    return 'ok';
  }

  private forgetDrop(k: Knock): void {
    if (k.sealed) this.storedBytes -= k.sealed.length;
    k.sealed = undefined;
  }

  /** Picked up or cancelled: everything is forgotten except the outcome, kept briefly. */
  finish(k: Knock, status: 'gone' | 'cancelled'): void {
    // Picked up: the receiver's id is gone, so the drop can't be fetched twice. Cancelled: both
    // sides keep a brief tombstone so each can show "cancelled".
    if (status === 'gone') this.byId.delete(k.id);
    this.byCode.delete(k.code);
    this.forgetDrop(k);
    k.giverKey = undefined; k.receiverKey = undefined; k.r = undefined;
    k.status = status; k.expiresAt = Math.min(k.expiresAt, this.now() + TOMBSTONE_MS);
  }

  private remove(k: Knock): void {
    this.forgetDrop(k);
    this.byId.delete(k.id); this.byCode.delete(k.code);
    if (k.ticket) this.byTicket.delete(k.ticket);
  }

  sweep(): void {
    const t = this.now();
    for (const k of [...this.byId.values(), ...this.byTicket.values()]) if (k.expiresAt <= t) this.remove(k);
  }
}
