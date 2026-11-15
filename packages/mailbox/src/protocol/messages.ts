/** Shapes and limits shared by the mailbox client and server. Binary values are base64. */
export const KNOCK_TTL_MS = 10 * 60 * 1000;
export const DROP_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_DROP_BYTES = 2 * 1024 * 1024;   // sealed, before base64

export type KnockStatus = 'waiting' | 'rung' | 'revealed' | 'dropped' | 'cancelled' | 'gone';
export interface CreateKnockReq { commitment: string }
export interface CreateKnockRes { id: string; code: string; expiresAt: number }
export interface RingReq { code: string; giverKey: string }
export interface RingRes { ticket: string; commitment: string }
export interface ReceiverPoll { status: KnockStatus; giverKey?: string }
export interface RevealReq { receiverKey: string; r: string }
export interface GiverPoll { status: KnockStatus; receiverKey?: string; r?: string }
export interface DropReq { sealed: string }
export interface DropRes { sealed: string; giverKey: string }
export type ErrorCode = 'update' | 'pow' | 'not-found' | 'too-big' | 'busy' | 'bad-request';
