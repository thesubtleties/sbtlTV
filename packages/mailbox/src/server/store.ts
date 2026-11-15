/** Knocks in memory. One replica; a restart loses knocks in flight, which users simply start again. */
import { randomBytes } from 'node:crypto';
import { DROP_TTL_MS, KNOCK_TTL_MS, newCode, type KnockStatus } from '../protocol';

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
  constructor(private now: () => number, private maxActive = 10_000, private maxStoredBytes = 128 * 1024 * 1024) {}

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

  ring(k: Knock, giverKey: string): string {
    k.ticket = randomBytes(16).toString('hex');
    k.giverKey = giverKey; k.status = 'rung';
    this.byTicket.set(k.ticket, k);
    this.byCode.delete(k.code);            // a code rings once
    return k.ticket;
  }

  /** false = no room right now (memory budget); the giver can try again later. */
  drop(k: Knock, sealed: string): boolean {
    this.sweep();
    if (this.storedBytes + sealed.length > this.maxStoredBytes) return false;
    this.storedBytes += sealed.length;
    k.sealed = sealed; k.status = 'dropped'; k.expiresAt = this.now() + DROP_TTL_MS;
    return true;
  }

  private forgetDrop(k: Knock): void {
    if (k.sealed) this.storedBytes -= k.sealed.length;
    k.sealed = undefined;
  }

  /** Picked up or cancelled: everything is forgotten; the giver's ticket keeps the outcome briefly. */
  finish(k: Knock, status: 'gone' | 'cancelled'): void {
    this.byId.delete(k.id); this.byCode.delete(k.code);
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
