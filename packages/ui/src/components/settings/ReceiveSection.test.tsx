import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReceiveSection } from './ReceiveSection';
import type { ImportState, SetupImport } from './useSetupImport';

// The server render reads a zustand store's initial state, so the sources come from a mock
let sources: unknown[] = [];
vi.mock('../../stores/uiStore', () => ({ useUIStore: (pick: (s: { sources: unknown[] }) => unknown) => pick({ sources }) }));

const preview = { app: '0.17.0', exportedAt: '2026-11-16T10:00:00Z', platform: 'darwin', sources: [{ name: 'TV', type: 'xtream', withLogin: true, fromFile: false, host: 'tv.example' }], settings: true, apiKeys: [], favorites: 0, watchlist: 0, progress: 0 };
const noop = () => {};
const im = (imp: ImportState) => ({
  imp, setImp: noop, passphrase: '', setPassphrase: noop, unlocking: false, backupFirst: true, setBackupFirst: noop,
  pick: async () => {}, unlock: async () => {}, apply: async () => {}, restoreNow: async () => {}, openBackup: async () => {},
  joinName: '', setJoinName: noop, joining: false, joinError: null, join: async () => {}, declineJoin: noop, defaultName: 'Linux PC', syncing: false,
}) as unknown as SetupImport;
const render = (imp: ImportState) => renderToStaticMarkup(createElement(ReceiveSection, { im: im(imp), receiving: false, onReceiving: noop, actions: createElement('span') }));

afterEach(() => { sources = []; });

describe('ReceiveSection', () => {
  it('a setup received on a computer with no sources: just Set up or Decline, no replace warning or backup', () => {
    const html = render({ step: 'preview', token: 't', preview: preview as never, received: true });
    expect(html).toContain('>Set up sbtlTV<');
    expect(html).toContain('>Decline<');
    expect(html).not.toContain('Back up my setup first');
    expect(html).not.toContain('>Replace<');
  });
  it('with a source already here (saved earlier in the walkthrough), it warns and offers the backup', () => {
    sources = [{ id: 's1', name: 'Mine', type: 'm3u', url: 'http://x' }];
    const html = render({ step: 'preview', token: 't', preview: preview as never, received: true });
    expect(html).toContain('Back up my setup first');
    expect(html).toContain('>Replace<');
    expect(html).not.toContain('>Set up sbtlTV<');
  });
  it('a join names the computers', () => {
    expect(render({ step: 'join', computers: ['Mac', 'Windows PC'] })).toContain('Join sync with Mac and Windows PC?');
  });
  it('applying says it restarts', () => {
    expect(render({ step: 'applying' })).toContain('sbtlTV restarts when done');
  });
});
