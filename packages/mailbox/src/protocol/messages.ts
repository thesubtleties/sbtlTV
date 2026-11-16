/** Shapes and limits shared by the mailbox client and server. Binary values are base64. */
export const KNOCK_TTL_MS = 10 * 60 * 1000;
/** The receiver is waiting live for the drop, so it doesn't need to last long; short keeps memory free. */
export const DROP_TTL_MS = 10 * 60 * 1000;
export const MAX_DROP_BYTES = 2 * 1024 * 1024;   // sealed, before base64

/**
 * claimed = a giver used the code and has the commitment but hasn't sent its key yet.
 * picked = the receiver fetched the drop and hasn't said yet whether it opened; gone = it did;
 * unreadable = it didn't (the giver hears so instead of "received").
 */
export type KnockStatus = 'waiting' | 'claimed' | 'rung' | 'revealed' | 'dropped' | 'picked' | 'cancelled' | 'gone' | 'unreadable';
export interface CreateKnockReq { commitment: string }
export interface CreateKnockRes { id: string; code: string; expiresAt: number }
/** The giver gets the commitment first and only then sends its key (KeyReq), so its key can't be matched to a commitment chosen afterwards. */
export interface RingReq { code: string }
export interface KeyReq { giverKey: string }
export interface RingRes { ticket: string; commitment: string }
export interface ReceiverPoll { status: KnockStatus; giverKey?: string }
export interface RevealReq { receiverKey: string; r: string }
export interface GiverPoll { status: KnockStatus; receiverKey?: string; r?: string }
export interface DropReq { sealed: string }
export interface DropRes { sealed: string; giverKey: string }
export interface ReceiptReq { ok: boolean }
export interface HelloRes { bits: number; time: number; challenge: string }
export type ErrorCode = 'update' | 'pow' | 'not-found' | 'too-big' | 'busy' | 'bad-request';
