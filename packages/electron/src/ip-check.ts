// "Check what IP they see" (Settings > Privacy): one request, only when the
// user asks, to Mullvad's public checker. Pure parsing here, so it runs under
// node:test; main.ts makes the request.

import { isIP } from 'node:net';

export const IP_CHECK_URL = 'https://am.i.mullvad.net/json';
/** The checker's answer is a few hundred bytes; anything far larger is not it. */
export const IP_CHECK_MAX_BYTES = 16 * 1024;

export interface IpCheckResult {
  ip: string;
  /** "San Jose, CA" */
  city: string | null;
  country: string | null;
  /** Who owns the address: an ISP, or a VPN's hosting company */
  organization: string | null;
  /** The Mullvad server this connection leaves from, when it is a Mullvad exit */
  mullvadServer: string | null;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : null);

/** The checker's answer, keeping only what the page shows (the coordinates are dropped). */
export function parseIpCheck(value: unknown): IpCheckResult | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const ip = text(v.ip);
  if (!ip || isIP(ip) === 0) return null;
  return {
    ip,
    city: text(v.city),
    country: text(v.country),
    organization: text(v.organization),
    mullvadServer: v.mullvad_exit_ip === true ? (text(v.mullvad_exit_ip_hostname) ?? 'Mullvad') : null,
  };
}
