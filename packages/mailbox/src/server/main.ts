import { serve } from '@hono/node-server';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 8080);
const { app } = createApp({
  powBits: Number(process.env.POW_BITS ?? 20),
  minVersion: process.env.MIN_APP_VERSION ?? '0.17.0',
});
// No request logging, by design. One startup line, no addresses.
serve({ fetch: app.fetch, port });
console.log(`mailbox listening on ${port}`);
