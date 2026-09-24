import { describe, it, expect, vi } from 'vitest';
import { DataClient } from './client';

// A fake MessagePort pair with the subset the client uses.
type Listener = (e: { data: unknown }) => void;
function pair() {
  const a = { listeners: [] as Listener[] } as unknown as MessagePort & { listeners: Listener[] };
  const b = { listeners: [] as Listener[] } as unknown as MessagePort & { listeners: Listener[] };
  a.postMessage = (m: unknown) => queueMicrotask(() => b.listeners.forEach((l) => l({ data: m })));
  b.postMessage = (m: unknown) => queueMicrotask(() => a.listeners.forEach((l) => l({ data: m })));
  for (const p of [a, b]) {
    p.addEventListener = ((_: string, l: Listener) => p.listeners.push(l)) as unknown as MessagePort['addEventListener'];
    p.start = () => {};
  }
  return [a as MessagePort, b as MessagePort] as const;
}

describe('DataClient', () => {
  it('matches replies to requests by id and revives dates', async () => {
    const [renderer, server] = pair();
    server.addEventListener('message', (e: { data: unknown }) => {
      const req = e.data as { id: number; type: string };
      if (req.type === 'programsInRange') server.postMessage({ id: req.id, ok: true, data: [{ id: 'p', stream_id: 's', title: 't', description: '', start: 1000, end: 2000, source_id: 'x' }] });
    });
    const client = new DataClient();
    client.attach(renderer);
    const rows = await client.query({ type: 'programsInRange', streamIds: ['s'], windowStartMs: 0, windowEndMs: 5000 });
    expect(rows[0].start).toBeInstanceOf(Date);
    expect(rows[0].start.getTime()).toBe(1000);
  });

  it('maps sync status rows onto the hook contract', async () => {
    const [renderer, server] = pair();
    server.addEventListener('message', (e: { data: unknown }) => {
      const req = e.data as { id: number };
      server.postMessage({ id: req.id, ok: true, data: [{ source_id: 's1', epg_url: null, last_channel_sync: 5000, last_epg_sync: null, last_vod_sync: 7000, channel_count: 3, category_count: 1, movie_count: 2, series_count: 0, error: null }] });
    });
    const client = new DataClient();
    client.attach(renderer);
    const [row] = await client.query({ type: 'syncStatus' });
    expect(row.last_synced?.getTime()).toBe(5000);
    expect(row.vod_last_synced?.getTime()).toBe(7000);
    expect(row.epg_url).toBeUndefined();
    expect(row.vod_movie_count).toBe(2);
  });

  it('rejects on an error reply and notifies subscribers of matching table changes', async () => {
    const [renderer, server] = pair();
    server.addEventListener('message', (e: { data: unknown }) => {
      const req = e.data as { id: number };
      server.postMessage({ id: req.id, ok: false, error: 'nope' });
    });
    const client = new DataClient();
    client.attach(renderer);
    await expect(client.query({ type: 'syncStatus' })).rejects.toThrow('nope');
    let hits = 0;
    client.subscribe(['channels'], () => hits++);
    server.postMessage({ kind: 'changed', table: 'channels', sourceId: 's1' });
    server.postMessage({ kind: 'changed', table: 'vod_movies', sourceId: 's1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(hits).toBe(1);
  });

  it('queues queries until a port is attached', async () => {
    const [renderer, server] = pair();
    server.addEventListener('message', (e: { data: unknown }) => {
      const req = e.data as { id: number };
      server.postMessage({ id: req.id, ok: true, data: 4 });
    });
    const client = new DataClient();
    const pending = client.query({ type: 'channelCount', sourceIds: [] });
    client.attach(renderer);
    expect(await pending).toBe(4);
  });
});

describe('DataClient port acquisition', () => {
  it('keeps asking for a port until one is attached', () => {
    vi.useFakeTimers();
    try {
      const [renderer] = pair();
      const client = new DataClient();
      let asks = 0;
      client.requestPortUntilAttached(() => asks++, 1000);
      expect(asks).toBe(1);
      vi.advanceTimersByTime(2500);
      expect(asks).toBe(3);
      client.attach(renderer);
      vi.advanceTimersByTime(5000);
      expect(asks).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DataClient reconnect', () => {
  it('rejects requests that were waiting on a port that went away', async () => {
    const [renderer] = pair();
    const [renderer2] = pair();
    const client = new DataClient();
    client.attach(renderer);
    const hung = client.query({ type: 'channelCount', sourceIds: [] });
    client.attach(renderer2);
    await expect(hung).rejects.toThrow(/reconnected/);
  });
});

describe('DataClient date and JSON revival', () => {
  it('revives movie dates and episode info', async () => {
    const [renderer, server] = pair();
    server.addEventListener('message', (e: { data: unknown }) => {
      const req = e.data as { id: number; type: string };
      if (req.type === 'movies') server.postMessage({ id: req.id, ok: true, data: [{ stream_id: 'm', added: 1000, match_attempted: null }] });
      if (req.type === 'episodes') server.postMessage({ id: req.id, ok: true, data: [{ id: 'e1', info: '{"rating":8}' }, { id: 'e2', info: '{broken' }, { id: 'e3', info: null }] });
    });
    const client = new DataClient();
    client.attach(renderer);
    const [movie] = await client.query({ type: 'movies', by: { kind: 'all' }, sourceIds: [] });
    expect(movie.added).toBeInstanceOf(Date);
    expect(movie.match_attempted).toBeNull();
    const episodes = await client.query({ type: 'episodes', seriesIds: ['s'] });
    expect(episodes.map((e) => e.info)).toEqual([{ rating: 8 }, undefined, undefined]);
  });
});
