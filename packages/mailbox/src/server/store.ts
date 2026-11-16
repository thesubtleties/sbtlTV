/** Knocks in memory. One replica; a restart loses knocks in flight, which users simply start again. */
import { randomBytes } from 'node:crypto';
import { DROP_TTL_MS, KNOCK_TTL_MS, newCode, type KnockStatus } from '../protocol/index.js';

export interface Knock {
  id: string; ticket: string | null; code: string; commitment: string;
  giverKey?: string; receiverKey?: string; r?: string; sealed?: string;
  status: KnockStatus; expiresAt: number;
  /** A drop upload is being read for this knock (one at a time per ticket) */
  dropping?: boolean;
}

/** How long a finished knock (received / cancelled / unreadable) stays visible to the polls, for a giver that was briefly offline. */
const TOMBSTONE_MS = 5 * 60_000;
/** How long the receiver has to say whether a fetched drop opened. */
const RECEIPT_MS = 2 * 60_000;

export class KnockStore {
  private byId = new Map<string, Knock>();
  private byCode = new Map<string, Knock>();
  private byTicket = new Map<string, Knock>();
  /** Bytes of sealed drops held right now (base64 length), kept under maxStoredBytes. */
  private storedBytes = 0;
  constructor(private now: () => number, private maxActive = 200_000, maxStoredBytes: number | (() => number) = 256 * 1024 * 1024) {
    this.maxStoredBytes = typeof maxStoredBytes === 'function' ? maxStoredBytes : () => maxStoredBytes;
  }
  private maxStoredBytes: () => number;

  create(commitment: string): Knock | null {
    this.sweep();
    if (this.byId.size >= this.maxActive) this.sweep(true);
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
    // The words, the person checking them and the giver's work all come after this: ten more minutes
    k.expiresAt = Math.max(k.expiresAt, this.now() + KNOCK_TTL_MS);
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
    this.sweep(true);
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

  /** The receiver fetched the drop: the sealed bytes are forgotten now; it says next whether they opened. */
  pick(k: Knock): void {
    this.forgetDrop(k);
    k.status = 'picked'; k.expiresAt = this.now() + RECEIPT_MS;
  }

  /** Received, cancelled or unreadable: everything is forgotten except the outcome, kept briefly. */
  finish(k: Knock, status: 'gone' | 'cancelled' | 'unreadable'): void {
    // Received: the receiver's id is gone. Otherwise both sides keep a brief tombstone so each can
    // show what happened.
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

  private lastSweep = -Infinity;

  /** Removes what has run out. At most once a second unless forced (main runs a forced one every minute). */
  sweep(force = false): void {
    const t = this.now();
    if (!force && t - this.lastSweep < 1000) return;
    this.lastSweep = t;
    for (const k of [...this.byId.values(), ...this.byTicket.values()]) if (k.expiresAt <= t) this.remove(k);
  }
}
