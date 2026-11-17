// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FirstRun, OfferSync } from './FirstRun';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const preview = { app: '0.17.0', exportedAt: '2026-11-16T10:00:00Z', platform: 'darwin', sources: [{ name: 'TV', type: 'xtream', withLogin: true, fromFile: false, host: 'tv.example' }], settings: true, apiKeys: [], favorites: 0, watchlist: 0, progress: 0 };

let calls: string[];
let saved: unknown[];
let root: Root;
let host: HTMLElement;

function stubWindow(mailboxState: () => unknown = () => ({ data: { role: 'receive', state: { step: 'code', code: 'abc' } } })) {
  calls = []; saved = [];
  Object.assign(window, {
    storage: {
      isEncryptionAvailable: async () => ({ data: true }),
      updateSettings: async (s: unknown) => { await new Promise((r) => setTimeout(r, 0)); calls.push(`save ${JSON.stringify(s)}`); saved.push(s); return {}; },
      getSources: async () => ({ data: [] }),
    },
    platform: { getVersion: async () => '0.17.0', isLinux: true },
    mailbox: { receive: async () => {}, state: async () => mailboxState(), cancel: async () => { calls.push('cancel'); } },
    sync: { view: async () => ({ defaultName: 'Linux PC', status: 'off' }) },
    setup: {
      apply: async () => { calls.push('apply'); return { success: true, data: { lists: null, backupName: null } }; },
      relaunch: async () => { calls.push('relaunch'); },
    },
  });
}

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
const click = async (text: string) => {
  const b = button(text);
  if (!b) throw new Error(`no button "${text}" in: ${host.textContent}`);
  await act(async () => { b.click(); });
};
const settle = (ms = 0) => act(() => new Promise((r) => setTimeout(r, ms)));

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('FirstRun (DOM)', () => {
  it('"just let me in" marks it done for good and records this version as seen', async () => {
    stubWindow();
    const onFinish = vi.fn();
    await act(async () => { root.render(createElement(FirstRun, { onFinish })); });
    await click("I know what I'm doing");
    await settle();
    expect(saved).toContainEqual({ firstRun: 'done', lastSeenVersion: '0.17.0' });
    expect(onFinish).toHaveBeenCalledWith('none');
  });

  it('Set up walks to the source step; Back returns to Welcome', async () => {
    stubWindow();
    await act(async () => { root.render(createElement(FirstRun, { onFinish: () => {} })); });
    await click('Set up sbtlTV');
    expect(host.textContent).toContain('Your TV source');
    await click('Back');
    expect(host.textContent).toContain('Welcome to sbtlTV');
  });

  it('a setup received with a code saves the sync-offer marker before it is applied and the app restarts', async () => {
    let received = false;
    stubWindow(() => received
      ? { data: { role: 'receive', state: { step: 'received' }, staged: { token: 't1', preview } } }
      : { data: { role: 'receive', state: { step: 'code', code: 'abc' } } });
    await act(async () => { root.render(createElement(FirstRun, { onFinish: () => {} })); });
    await click('Receive a setup');
    received = true;
    await settle(600);
    await click('Set up sbtlTV');
    await settle();
    expect(calls.filter((c) => c !== 'cancel')).toEqual([`save ${JSON.stringify({ firstRun: 'offer-sync' })}`, 'apply', 'relaunch']);
  });

  it('declining a received setup goes back to Welcome', async () => {
    let received = false;
    stubWindow(() => received
      ? { data: { role: 'receive', state: { step: 'received' }, staged: { token: 't1', preview } } }
      : { data: { role: 'receive', state: { step: 'code', code: 'abc' } } });
    await act(async () => { root.render(createElement(FirstRun, { onFinish: () => {} })); });
    await click('Receive a setup');
    received = true;
    await settle(600);
    await click('Decline');
    expect(host.textContent).toContain('Welcome to sbtlTV');
    expect(calls).not.toContain('apply');
  });
});

describe('OfferSync (DOM)', () => {
  it('Not now marks the first run done', async () => {
    stubWindow();
    const onFinish = vi.fn();
    await act(async () => { root.render(createElement(OfferSync, { onFinish })); });
    await click('Not now');
    await settle();
    expect(saved).toContainEqual({ firstRun: 'done', lastSeenVersion: '0.17.0' });
    expect(onFinish).toHaveBeenCalled();
  });
  it('Cancel while showing the code goes back to the offer and finishes nothing', async () => {
    stubWindow();
    const onFinish = vi.fn();
    await act(async () => { root.render(createElement(OfferSync, { onFinish })); });
    await click('Join its sync');
    await click('Cancel');
    expect(host.textContent).toContain('Also keep your lists in sync');
    expect(onFinish).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });
});
