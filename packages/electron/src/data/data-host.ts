/**
 * Main-side supervisor for the data process: forks it, restarts it when it
 * exits, relays its log lines into the debug log, pushes sources and settings,
 * and hands each renderer a direct MessagePort to it.
 */
import { utilityProcess, MessageChannelMain, type UtilityProcess, type WebContents, type MessagePortMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Source, DataSettings, ControlMessage, ControlReply, SyncProgress } from '@sbtltv/core';

export interface DataHostOptions {
  dbPath: string;
  tempDir: string;
  getSources(): Source[];
  getSettings(): DataSettings;
  log(category: string, message: string): void;
  onSync(p: SyncProgress): void;
}
export interface DataHost {
  pushSources(): void;
  pushSettings(): void;
  deleteSource(id: string): void;
  giveRendererPort(wc: WebContents): void;
  shutdown(): void;
}

export function startDataHost(opts: DataHostOptions): DataHost {
  let child: UtilityProcess | null = null;
  let ready = false;
  let stopping = false;
  let restarts = 0;
  let fatal = false;
  let restartTimer: NodeJS.Timeout | null = null;
  const wanting = new Set<WebContents>();

  const send = (m: ControlMessage, ports: MessagePortMain[] = []) => child?.postMessage(m, ports);

  function givePort(wc: WebContents): void {
    const { port1, port2 } = new MessageChannelMain();
    send({ type: 'renderer-port' }, [port1]);
    wc.postMessage('data-port', null, [port2]);
    opts.log('data', `renderer port handed to webContents ${wc.id}`);
  }

  function spawn(): void {
    if (stopping) return;
    restartTimer = null;
    const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data-process.js');
    ready = false;
    fatal = false;
    child = utilityProcess.fork(entry, [], { serviceName: 'sbtltv-data', stdio: 'pipe' });
    child.stdout?.on('data', (d) => opts.log('data', String(d).trimEnd()));
    child.stderr?.on('data', (d) => opts.log('data', `stderr: ${String(d).trimEnd()}`));
    child.on('message', (m: ControlReply) => {
      switch (m.type) {
        case 'ready':
          ready = true; restarts = 0;
          opts.log('data', 'data process ready');
          for (const wc of wanting) if (!wc.isDestroyed()) givePort(wc);
          break;
        case 'log': opts.log(m.category, m.message); break;
        case 'sync': opts.onSync(m.progress); break;
        case 'fatal': fatal = true; opts.log('data', `FATAL: ${m.error}`); break;
      }
    });
    child.on('exit', (code) => {
      child = null; ready = false;
      if (stopping) return;
      if (fatal) {
        // A deterministic startup failure (migration, unreadable file): a restart
        // would only loop. The log has the reason; the app keeps running without data.
        opts.log('data', `data process exited with ${code} after a fatal error; not restarting`);
        return;
      }
      restarts++;
      const delay = Math.min(30_000, 1000 * 2 ** restarts);
      opts.log('data', `data process exited with ${code}; restarting in ${delay}ms`);
      restartTimer = setTimeout(spawn, delay);
    });
    send({ type: 'init', dbPath: opts.dbPath, tempDir: opts.tempDir, sources: opts.getSources(), settings: opts.getSettings() });
  }

  spawn();
  return {
    pushSources: () => send({ type: 'sources', sources: opts.getSources() }),
    pushSettings: () => send({ type: 'settings', settings: opts.getSettings() }),
    deleteSource: (id) => send({ type: 'deleteSource', sourceId: id }),
    giveRendererPort: (wc) => {
      if (!wanting.has(wc)) { wanting.add(wc); wc.once('destroyed', () => wanting.delete(wc)); }
      if (ready) givePort(wc);
    },
    shutdown: () => {
      stopping = true;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      send({ type: 'shutdown' });
    },
  };
}
