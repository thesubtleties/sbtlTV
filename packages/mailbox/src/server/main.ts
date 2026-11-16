import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8080);
const { app } = createApp({
  powBits: Number(process.env.POW_BITS ?? 20),
  minVersion: process.env.MIN_APP_VERSION ?? '0.17.0',
  // Behind the cluster's load balancer every client may share one address, so this is close to a
  // limit for everyone together: a backstop, high by default. Proof-of-work (POW_BITS) is the real cost.
  writesPerHour: Number(process.env.WRITES_PER_HOUR ?? 100_000),
  // Memory for drops nobody has picked up yet; when full, new sends hear "busy" until it frees (≤ 10 min)
  maxStoredBytes: Number(process.env.DROP_MEMORY_MB ?? 2048) * 1024 * 1024,
  // Large drops (only big file playlists are over 256 KB) share this per hour, everyone together
  largeDropBytesPerHour: Number(process.env.LARGE_DROP_MB_PER_HOUR ?? 200) * 1024 * 1024,
  // Switches, one `kubectl set env` away: refuse every write, or only large drops, as "busy"
  paused: process.env.MAILBOX_PAUSED === '1',
  largeDropsPaused: process.env.LARGE_DROPS_PAUSED === '1',
});
// No request logging, by design. One startup line, no addresses.
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });  // every interface: the pod is reached through its Service
console.log(`mailbox listening on ${port}`);
