// packages/electron/src/mailbox/relay-transport.ts
/** HTTP to the sbtlTV relay from the main process: a plain User-Agent, no cookies, no redirects. */
import { app, net } from 'electron';
import { Transport } from '@sbtltv/mailbox/client';
import { measurePowRate, powSecondsUpTo } from '@sbtltv/mailbox/protocol';

export const MAILBOX_BASE = 'https://relay.sbtltv.com';
let powRate = 0;

export function relayTransport(opts: { auth?: string; onWorkSeconds?: (s: number) => void } = {}): Transport {
  // SBTLTV_MAILBOX points a development build at a local relay; a released app always uses the real one
  const base = !app.isPackaged && process.env.SBTLTV_MAILBOX ? process.env.SBTLTV_MAILBOX : MAILBOX_BASE;
  return new Transport({
    base, version: app.getVersion(), auth: opts.auth,
    fetch: (req) => {
      const headers = new Headers(req.headers);
      headers.set('user-agent', 'sbtlTV');
      headers.set('accept-language', '*');
      return net.fetch(new Request(req, { headers, credentials: 'omit', redirect: 'error' }), { cache: 'no-store', bypassCustomProtocolHandlers: true });
    },
    onWork: (bits) => { powRate ||= measurePowRate(); opts.onWorkSeconds?.(powSecondsUpTo(bits, powRate)); },
  });
}
