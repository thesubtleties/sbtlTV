import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import type { TextureInfo } from '@sbtltv/mpv-texture';
import type { MpvTextureBridge } from './mpv-texture-bridge.js';

async function createBridge() {
  const nativeReleases: number[] = [];
  const failures: string[] = [];
  let frameCallback: ((frame: TextureInfo) => void) | undefined;
  let destroyed = false;
  let stops = 0;
  const webContents = Object.assign(new EventEmitter(), { mainFrame: {}, send() {} });
  const imports: Array<{
    release: () => void;
    releaseRenderer: () => void;
    mainReleases: number;
    rendererOwns: boolean;
  }> = [];
  const sends: Array<{ acknowledge: () => void; reject: () => void }> = [];
  const native = {
    isInitialized: true,
    create() {},
    onFrame(callback: (frame: TextureInfo) => void) { frameCallback = callback; },
    onStatus() {}, onError() {},
    load: async () => {},
    stop() { stops++; },
    releaseFrame(bufferId: number) { nativeReleases.push(bufferId); },
    destroy() { destroyed = true; native.isInitialized = false; },
  };
  const sharedTexture = {
    importSharedTexture({ allReferencesReleased }: { allReferencesReleased: () => void }) {
      const imported = {
        mainReleases: 0,
        rendererOwns: false,
        release() {
          imported.mainReleases++;
          if (!imported.rendererOwns) allReferencesReleased();
        },
        releaseRenderer() {
          imported.rendererOwns = false;
          if (imported.mainReleases) allReferencesReleased();
        },
      };
      imports.push(imported);
      return imported;
    },
    sendSharedTexture({ importedSharedTexture }: { importedSharedTexture: typeof imports[number] }) {
      return new Promise<void>((resolve, reject) => {
        sends.push({
          acknowledge() { importedSharedTexture.rendererOwns = true; resolve(); },
          reject() { reject(new Error('transfer shared texture timed out after 1000ms')); },
        });
      });
    },
  };
  let now = 0;
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, Buffer, performance: { now: () => now },
    setInterval: () => 0, clearInterval() {},
  });
  const electron = new vm.SyntheticModule(['sharedTexture'], function () {
    this.setExport('sharedTexture', sharedTexture);
  }, { context });
  const addon = new vm.SyntheticModule(['mpvTexture'], function () {
    this.setExport('mpvTexture', native);
  }, { context });
  await addon.link(() => { throw new Error('Unexpected addon dependency'); });
  await addon.evaluate();
  const source = readFileSync(new URL('./mpv-texture-bridge.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, {
    context,
    importModuleDynamically: async () => addon,
  });
  await module.link(specifier => {
    assert.equal(specifier, 'electron');
    return electron;
  });
  await module.evaluate();
  const { MpvTextureBridge: Bridge } = module.namespace as { MpvTextureBridge: new () => MpvTextureBridge };
  const bridge = new Bridge();
  await bridge.initialize({ webContents, isDestroyed: () => false } as unknown as Parameters<MpvTextureBridge['initialize']>[0]);
  bridge.onPipelineFailure(message => failures.push(message));
  return {
    bridge, webContents, nativeReleases, failures, imports, sends,
    get destroyed() { return destroyed; },
    get stops() { return stops; },
    advance(ms: number) { now += ms; },
    frame(bufferId: number) {
      assert.ok(frameCallback);
      frameCallback({ kind: 'nativePixmap', bufferId, width: 16, height: 16, format: 'bgra',
        nativePixmap: { planes: [{ fd: 1, stride: 64, offset: 0, size: 1024 }], modifier: '0', supportsZeroCopyWebGpuImport: false } });
    },
  };
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('successful transfer retains the native buffer until renderer references are released', async () => {
  const state = await createBridge();
  state.frame(1);
  state.sends[0].acknowledge();
  await settle();
  assert.equal(state.imports[0].mainReleases, 1);
  assert.deepEqual(state.nativeReleases, []);
  const destruction = state.bridge.destroy();
  assert.equal(state.destroyed, false);
  state.imports[0].releaseRenderer();
  await destruction;
  assert.deepEqual(state.nativeReleases, [1]);
  assert.equal(state.destroyed, true);
});

test('a brief run of timeouts is tolerated and a later success re-arms the bridge', async () => {
  const state = await createBridge();
  state.frame(1);
  state.frame(2);
  state.sends[0].reject();
  await settle();
  state.advance(1000);
  state.sends[1].reject();
  await settle();
  assert.equal(state.failures.length, 0);
  assert.equal(state.stops, 0);
  // Timed-out imports stay retained: Electron may still deliver them.
  assert.equal(state.imports[0].mainReleases, 0);
  assert.equal(state.imports[1].mainReleases, 0);
  state.frame(3);
  state.sends[2].acknowledge();
  await settle();
  assert.equal(state.bridge.isInitialized(), true);
  state.frame(4);
  state.advance(1000);
  state.sends[3].reject();
  await settle();
  assert.equal(state.failures.length, 0, 'counter restarted after the success');
  const destruction = state.bridge.destroy();
  state.imports[2].releaseRenderer();
  state.webContents.emit('destroyed');
  await destruction;
  assert.equal(state.imports[0].mainReleases, 1);
  assert.equal(state.imports[1].mainReleases, 1);
  assert.equal(state.imports[3].mainReleases, 1);
});

test('timeouts persisting for 3s stop transfers and retain uncertain ownership until renderer disposal', async () => {
  const state = await createBridge();
  state.frame(1);
  state.frame(2);
  state.sends[0].reject();
  await settle();
  state.advance(1000);
  state.sends[1].reject();
  await settle();
  assert.equal(state.failures.length, 0);
  state.frame(3);
  state.frame(4);
  assert.equal(state.sends.length, 4);
  state.advance(2000);
  state.sends[2].reject();
  await settle();
  assert.equal(state.failures.length, 1);
  assert.equal(state.stops, 1);
  assert.equal(state.imports[0].mainReleases, 0);
  assert.deepEqual(state.nativeReleases, []);
  state.frame(5);
  assert.equal(state.sends.length, 4, 'no transfers start after failure');
  assert.deepEqual(state.nativeReleases, [5]);
  await assert.rejects(state.bridge.load('test'), /must be reset/);

  // An already-started successful transfer cannot re-arm the failed bridge.
  state.sends[3].acknowledge();
  await settle();
  assert.equal(state.bridge.isInitialized(), false);
  const destruction = state.bridge.destroy();
  state.imports[3].releaseRenderer();
  assert.equal(state.destroyed, false);
  state.webContents.emit('destroyed');
  await destruction;
  assert.equal(state.imports[0].mainReleases, 1);
  assert.deepEqual([...state.nativeReleases].sort(), [1, 2, 3, 4, 5]);
  assert.equal(state.failures.length, 1);
});

test('a transfer that rejects after renderer disposal releases exactly once', async () => {
  const state = await createBridge();
  state.frame(1);
  const destruction = state.bridge.destroy();
  state.webContents.emit('destroyed');
  state.sends[0].reject();
  await destruction;
  assert.equal(state.imports[0].mainReleases, 1);
  assert.deepEqual(state.nativeReleases, [1]);
  await state.bridge.destroy();
  assert.deepEqual(state.nativeReleases, [1]);
});
