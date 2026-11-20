import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useSetupImport, type SetupImport } from './useSetupImport';

// No DOM: render once on the server to get the hook's functions, then call them.
// (State updates after a server render are dropped; the calls into window.setup are what's checked.)
function capture(): SetupImport {
  let im: SetupImport | undefined;
  const Probe = () => { im = useSetupImport(); return null; };
  renderToStaticMarkup(createElement(Probe));
  return im!;
}

const g = globalThis as unknown as { window?: unknown };
afterEach(() => { delete g.window; });

function stubSetup(apply: () => Promise<unknown>) {
  const calls: string[] = [];
  g.window = {
    setup: {
      apply: vi.fn(async () => { calls.push('apply'); return apply(); }),
      relaunch: vi.fn(async () => { calls.push('relaunch'); }),
    },
  };
  return calls;
}

describe('useSetupImport.apply', () => {
  it('runs the before step (the first run saves its sync-offer marker there) before the setup is applied and the app restarts', async () => {
    const calls = stubSetup(async () => ({ success: true, data: { lists: null, backupName: null } }));
    // The marker is saved over IPC: the apply must wait for it, not just start it
    await capture().apply('t', false, async () => { await new Promise((r) => setTimeout(r, 0)); calls.push('before'); });
    expect(calls).toEqual(['before', 'apply', 'relaunch']);
  });
  it('a failed apply does not restart', async () => {
    const calls = stubSetup(async () => ({ error: 'bad', backupName: null }));
    await capture().apply('t', false, async () => { calls.push('before'); });
    expect(calls).toEqual(['before', 'apply']);
  });
  it('a before step that throws applies nothing', async () => {
    const calls = stubSetup(async () => ({ success: true, data: { lists: null, backupName: null } }));
    await capture().apply('t', false, async () => { throw new Error('x'); });
    expect(calls).toEqual([]);
  });
});
