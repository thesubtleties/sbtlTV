import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8080);
const { app } = createApp({
  powBits: Number(process.env.POW_BITS ?? 20),
  minVersion: process.env.MIN_APP_VERSION ?? '0.17.0',
});
// No request logging, by design. One startup line, no addresses.
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });  // every interface: the pod is reached through its Service
console.log(`mailbox listening on ${port}`);
