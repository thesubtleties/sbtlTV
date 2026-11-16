import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { LiveSettings, fileReader, settingsFromEnv } from './settings.js';

const port = Number(process.env.PORT ?? 8080);
// Knobs: defaults (settings.ts) <- environment <- MAILBOX_CONFIG_FILE (JSON, mounted from Infisical,
// re-read every 30 s: changing it needs no restart and keeps the values out of every repo)
const settings = new LiveSettings(settingsFromEnv(process.env), fileReader(process.env.MAILBOX_CONFIG_FILE));
const { app } = createApp({ settings: () => settings.get() });
// No request logging, by design. One startup line, no addresses.
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });  // every interface: the pod is reached through its Service
console.log(`relay listening on ${port}`);
