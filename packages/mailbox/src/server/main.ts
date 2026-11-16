import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { MemoryGroupStore, utcDay, type GroupStore } from './groups.js';
import { PgGroupStore, makePool, migrate } from './pg-groups.js';
import { LiveSettings, fileReader, settingsFromEnv } from './settings.js';

const port = Number(process.env.PORT ?? 8080);
// Knobs: defaults (settings.ts) <- environment <- MAILBOX_CONFIG_FILE (JSON, mounted from Infisical,
// re-read every 30 s: changing it needs no restart and keeps the values out of every repo)
const settings = new LiveSettings(settingsFromEnv(process.env), fileReader(process.env.MAILBOX_CONFIG_FILE));
// Sync groups: Postgres when DATABASE_URL is set (the cluster), else in memory (local development)
let groups: GroupStore = new MemoryGroupStore();
if (process.env.DATABASE_URL) {
  const pool = makePool(process.env.DATABASE_URL);
  await migrate(pool);
  groups = new PgGroupStore(pool);
}
const { app, store } = createApp({ settings: () => settings.get(), groups });
// No request logging, by design. One startup line, no addresses.
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });  // every interface: the pod is reached through its Service
console.log(`relay listening on ${port}`);
// Run-out drops leave memory within a minute even when nobody is sending
setInterval(() => store.sweep(true), 60_000).unref();
// Groups nobody has opened sbtlTV with for 90 days go with their boxes; moved groups once everyone caught up
const sweepGroups = () => void groups.sweep(utcDay(Date.now())).catch(() => {});
sweepGroups();
setInterval(sweepGroups, 6 * 3_600_000).unref();
// As PID 1 in the container Node ignores SIGTERM by default: stop now (closing the database pool, at most 2 s)
process.on('SIGTERM', () => {
  setTimeout(() => process.exit(0), 2000).unref();
  void groups.close().finally(() => process.exit(0));
});
