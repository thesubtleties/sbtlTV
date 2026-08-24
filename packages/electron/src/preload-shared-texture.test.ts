import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

interface ImportedTextureStub {
  getVideoFrame: () => VideoFrame;
  release: () => void;
}

interface SharedTextureApiStub {
  onFrame: (callback: (videoFrame: VideoFrame, index: number) => void) => void;
  onClear: (callback: () => void) => void;
}

type SharedTextureReceiver = (
  data: { importedSharedTexture: ImportedTextureStub },
  metadata: unknown
) => Promise<void>;

function loadSandboxedPreload(): {
  api: SharedTextureApiStub;
  listeners: Map<string, (...args: unknown[]) => void>;
  receiver: SharedTextureReceiver;
} {
  const preloadSource = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
  const exposedApis = new Map<string, unknown>();
  const listeners = new Map<string, (...args: unknown[]) => void>();
  let receiver: SharedTextureReceiver | undefined;

  const ipcRenderer = {
    invoke: async () => undefined,
    on: (channel: string, listener: (...args: unknown[]) => void) => listeners.set(channel, listener),
    removeAllListeners: () => undefined,
  };
  const sharedTexture = {
    setSharedTextureReceiver: (callback: SharedTextureReceiver) => {
      receiver = callback;
    },
  };

  vm.runInNewContext(preloadSource, {
    console,
    exports: {},
    module: { exports: {} },
    process: { argv: [], env: {}, platform: 'linux' },
    require: (specifier: string) => {
      if (specifier === 'electron/renderer') {
        return {
          contextBridge: {
            exposeInMainWorld: (name: string, api: unknown) => exposedApis.set(name, api),
          },
          ipcRenderer,
        };
      }
      if (specifier === 'electron') return { sharedTexture };
      throw new Error(`Sandbox preload cannot require ${specifier}`);
    },
  });

  const api = exposedApis.get('sharedTexture') as SharedTextureApiStub | undefined;
  assert.ok(api);
  assert.ok(receiver);
  return { api, listeners, receiver };
}

test('sandboxed preload loads without local module dependencies', () => {
  loadSandboxedPreload();
});

test('sandboxed preload rejects stale and out-of-order shared texture frames', async () => {
  const { api, listeners, receiver } = loadSandboxedPreload();
  const renderedIndices: number[] = [];
  let clearCount = 0;
  api.onFrame((_videoFrame, index) => renderedIndices.push(index));
  api.onClear(() => clearCount++);

  const clear = listeners.get('video-clear');
  assert.ok(clear);
  clear({}, 2);

  const receive = async (generation: number, index: number) => {
    let releaseCount = 0;
    await receiver({
      importedSharedTexture: {
        getVideoFrame: () => ({}) as VideoFrame,
        release: () => releaseCount++,
      },
    }, { generation, index });
    assert.equal(releaseCount, 1);
  };

  await receive(1, 10);
  await receive(2, 20);
  await receive(2, 19);
  await receive(3, 30);
  clear({}, 3);

  assert.deepEqual(renderedIndices, [20, 30]);
  assert.equal(clearCount, 1);
});
