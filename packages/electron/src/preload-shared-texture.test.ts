import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { JsxEmit, ModuleKind, transpileModule } from 'typescript';

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
  sentChannels: string[];
} {
  const preloadSource = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
  const exposedApis = new Map<string, unknown>();
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const sentChannels: string[] = [];
  let receiver: SharedTextureReceiver | undefined;

  const ipcRenderer = {
    invoke: async () => undefined,
    send: (channel: string) => { sentChannels.push(channel); },
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
  return { api, listeners, receiver, sentChannels };
}

// Run the real canvas callback and preload together, with successful GPU draws.
function mountVideoCanvas(api: SharedTextureApiStub): () => void {
  const effects: Array<() => void | (() => void)> = [];
  const gl = {
    createShader: () => ({}), shaderSource() {}, compileShader() {},
    getShaderParameter: () => true, deleteShader() {},
    createProgram: () => ({}), attachShader() {}, linkProgram() {},
    getProgramParameter: () => true, deleteProgram() {},
    getUniformLocation: () => ({}), createVertexArray: () => ({}),
    bindVertexArray() {}, deleteVertexArray() {}, createBuffer: () => ({}),
    bindBuffer() {}, bufferData() {}, deleteBuffer() {}, getAttribLocation: () => 0,
    enableVertexAttribArray() {}, vertexAttribPointer() {}, createTexture: () => ({}),
    bindTexture() {}, texParameteri() {}, deleteTexture() {}, texImage2D() {},
    useProgram() {}, uniform1i() {}, drawArrays() {}, flush() {},
  };
  const canvas = {
    width: 16, height: 16, getContext: () => gl,
    addEventListener() {}, removeEventListener() {},
  };
  const source = readFileSync(new URL('../../ui/src/components/VideoCanvas.tsx', import.meta.url), 'utf8');
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(compiled, {
    exports, console, performance, setTimeout, clearTimeout,
    window: { sharedTexture: api },
    require(specifier: string) {
      if (specifier === 'react') return {
        useRef: (current: unknown) => ({ current }),
        useCallback: (callback: unknown) => callback,
        useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
      };
      if (specifier === 'react/jsx-runtime') return {
        jsx: (_tag: string, props: { ref: { current: unknown } }) => {
          props.ref.current = canvas;
          return null;
        },
      };
      throw new Error(`Unexpected canvas dependency: ${specifier}`);
    },
  });
  assert.equal(typeof exports.VideoCanvas, 'function');
  (exports.VideoCanvas as (props: { visible: boolean }) => unknown)({ visible: true });
  const cleanups = effects.map(effect => effect());
  return () => { for (const cleanup of cleanups.reverse()) cleanup?.(); };
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

test('successful canvas draws clear intermittent preload import errors', async () => {
  const { api, receiver, sentChannels } = loadSandboxedPreload();
  const unmount = mountVideoCanvas(api);
  let closedFrames = 0;
  try {
    for (let index = 0; index < 10; index++) {
      await receiver({ importedSharedTexture: {
        getVideoFrame: () => {
          if (index % 2 === 0) throw new Error('simulated import failure');
          return { codedWidth: 16, codedHeight: 16, close: () => { closedFrames++; } } as VideoFrame;
        },
        release() {},
      } }, { generation: 0, index });
    }
    assert.equal(closedFrames, 5);
    assert.deepEqual(sentChannels, Array.from({ length: 5 }, () => [
      'shared-texture-frame-error', 'shared-texture-frame-ok',
    ]).flat());
  } finally {
    unmount();
  }
});
