import { randomBytes } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createApp } from './app.js';
import { keyId } from './at-rest.js';
import { MemoryGroupStore, utcDay, type GroupStore } from './groups.js';
import { PgGroupStore, makePool, migrate } from './pg-groups.js';
import { LiveSettings, fileReader, settingsFromEnv } from './settings.js';

const port = Number(process.env.PORT ?? 8080);
// Knobs: defaults (settings.ts) <- environment <- MAILBOX_CONFIG_FILE (JSON, mounted from Infisical,
// re-read every 30 s: changing it needs no restart and keeps the values out of every repo)
const settings = new LiveSettings(settingsFromEnv(process.env), fileReader(process.env.MAILBOX_CONFIG_FILE));
// Sync groups: Postgres when DATABASE_URL is set (the cluster), else in memory (local development).
// The relay serves at once (the knock never needs the database); sync answers busy until the
// database is ready, which is tried every 2 s in the background (a new pod reaches it ~20 s late).
// Everything stored is sealed again with the relay's own key (MAILBOX_STORAGE_KEY: 32 bytes as
// base64, from Infisical). Required with a database; without one a fresh key per start is enough.
const keyText = process.env.MAILBOX_STORAGE_KEY ?? '';
const storageKey = keyText ? Buffer.from(keyText, 'base64') : randomBytes(32);
if (storageKey.length !== 32 || (keyText && storageKey.toString('base64') !== keyText)) {
  console.error('MAILBOX_STORAGE_KEY must be 32 bytes as base64');
  process.exit(1);
}
let groups: GroupStore = new MemoryGroupStore();
let groupsReady = true;
if (process.env.DATABASE_URL) {
  if (!keyText) { console.error('MAILBOX_STORAGE_KEY is required with DATABASE_URL'); process.exit(1); }
  const pool = makePool(process.env.DATABASE_URL);
  groups = new PgGroupStore(pool);
  groupsReady = false;
  void (async () => {
    for (;;) {
      try { await migrate(pool, keyId(storageKey)); groupsReady = true; return; } catch { await new Promise((r) => setTimeout(r, 2000)); }
    }
  })();
}
const { app, store, groups: stored, renderMetrics } = createApp({ settings: () => settings.get(), groups, groupsReady: () => groupsReady, storageKey });
// No request logging, by design. One startup line, no addresses.
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });  // every interface: the pod is reached through its Service
console.log(`relay listening on ${port}`);
// Totals for the operator's dashboard on their own port: the Service the ingress uses doesn't
// carry it, so only the cluster (Prometheus) reaches it. Off when METRICS_PORT is 0.
const metricsPort = Number(process.env.METRICS_PORT ?? 9464);
if (metricsPort) {
  const metrics = new Hono();
  metrics.get('/metrics', async (c) => c.text(await renderMetrics(), 200, { 'content-type': 'text/plain; version=0.0.4' }));
  serve({ fetch: metrics.fetch, port: metricsPort, hostname: '0.0.0.0' });
}
// Run-out drops leave memory within a minute even when nobody is sending
setInterval(() => store.sweep(true), 60_000).unref();
// Groups nobody has opened sbtlTV with for 90 days go with their boxes; moved groups once everyone caught up
const sweepGroups = () => { if (groupsReady) void stored.sweep(utcDay(Date.now())).catch(() => {}); };
sweepGroups();
setInterval(sweepGroups, 6 * 3_600_000).unref();
// As PID 1 in the container Node ignores SIGTERM by default: stop now (closing the database pool, at most 2 s)
process.on('SIGTERM', () => {
  setTimeout(() => process.exit(0), 2000).unref();
  void groups.close().finally(() => process.exit(0));
});
