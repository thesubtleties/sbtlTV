// packages/mailbox/src/client/sync.test.ts
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveGroup, newDeviceId } from '../protocol/index.js';
import { createApp } from '../server/app.js';
import { MailboxError, Transport } from './transport.js';
import { SyncClient } from './sync.js';

function client(app: ReturnType<typeof createApp>['app'], K: Buffer) {
  const g = deriveGroup(K);
  const t = new Transport({ base: 'http://x', version: '0.17.0', bits: 4, auth: g.accessToken, fetch: async (req) => app.fetch(req) });
  return { sync: new SyncClient(t, g.groupId), g };
}

describe('SyncClient', () => {
  it('push, list since, leave', async () => {
    const { app } = createApp({ powBits: 4 });
    const { sync } = client(app, randomBytes(32));
    const a = newDeviceId();
    expect(await sync.list(0)).toBeNull();
    expect(await sync.push(a, Buffer.from('box-a'))).toBe(1);
    const l = await sync.list(0);
    expect(l && !l.moved && l.boxes[0].sealed.toString()).toBe('box-a');
    await sync.leave(a);
    expect(await sync.list(0)).toBeNull();
  });

  it('rekey and fetch; a removed computer gets null; late pushes say moved', async () => {
    const { app } = createApp({ powBits: 4 });
    const { sync } = client(app, randomBytes(32));
    const a = newDeviceId(), b = newDeviceId();
    await sync.push(a, Buffer.from('a')); await sync.push(b, Buffer.from('b'));
    const proof = randomBytes(32);
    await sync.rekey(new Map([[a, { sealed: randomBytes(140), ackHash: createHash('sha256').update(proof).digest() }]]));
    expect(await sync.list(0)).toEqual({ moved: true, waiting: 1 });
    expect(await sync.fetchRekey(a)).not.toBeNull();
    expect(await sync.list(0)).toEqual({ moved: true, waiting: 1 });   // fetching isn't picking up
    await sync.ackRekey(a, proof);
    expect(await sync.list(0)).toEqual({ moved: true, waiting: 0 });
    expect(await sync.fetchRekey(b)).toBeNull();
    await expect(sync.push(b, Buffer.from('late'))).rejects.toMatchObject({ code: 'moved' });
  });

  it('reads the database id', async () => {
    const { app } = createApp({ powBits: 4 });
    const { sync } = client(app, randomBytes(32));
    expect(await sync.epoch()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('a wrong key is denied', async () => {
    const { app } = createApp({ powBits: 4 });
    const one = client(app, randomBytes(32));
    await one.sync.push(newDeviceId(), Buffer.from('x'));
    const t = new Transport({ base: 'http://x', version: '0.17.0', bits: 4, auth: deriveGroup(randomBytes(32)).accessToken, fetch: async (req) => app.fetch(req) });
    await expect(new SyncClient(t, one.g.groupId).list(0)).rejects.toBeInstanceOf(MailboxError);
  });
});
