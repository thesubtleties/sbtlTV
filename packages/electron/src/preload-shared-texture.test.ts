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
interface CanvasHarnessOptions {
  /** Mount with window.platform.isLinux (frame pacing path) */
  linux?: boolean;
  /** Called by the canvas's requestAnimationFrame */
  onAnimationFrame?: (callback: (now: number) => void) => void;
  /** Counts drawArrays calls */
  draws?: { count: number };
}

function transpile(relativePath: string): string {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  return transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX },
  }).outputText;
}

function mountVideoCanvas(api: SharedTextureApiStub, options: CanvasHarnessOptions = {}): () => void {
  const effects: Array<() => void | (() => void)> = [];
  const draws = options.draws ?? { count: 0 };
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
    useProgram() {}, uniform1i() {}, drawArrays() { draws.count++; }, flush() {}, viewport() {},
  };
  const canvas = {
    width: 16, height: 16, getContext: () => gl,
    addEventListener() {}, removeEventListener() {},
  };
  const compiled = transpile('../../ui/src/components/VideoCanvas.tsx');
  const pacerExports: Record<string, unknown> = {};
  vm.runInNewContext(transpile('../../ui/src/hooks/framePacer.ts'), { exports: pacerExports });
  const perfMarksExports: Record<string, unknown> = {};
  vm.runInNewContext(transpile('../../ui/src/utils/perfMarks.ts'), { exports: perfMarksExports, performance });
  const audioDelayExports: Record<string, unknown> = {};
  vm.runInNewContext(transpile('../../ui/src/hooks/audioDelaySync.ts'), { exports: audioDelayExports });
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(compiled, {
    exports, console, performance, setTimeout, clearTimeout,
    requestAnimationFrame: (callback: (now: number) => void) => { options.onAnimationFrame?.(callback); return 1; },
    cancelAnimationFrame() {},
    window: { sharedTexture: api, platform: options.linux ? { isLinux: true } : undefined },
    require(specifier: string) {
      if (specifier === '../hooks/framePacer') return pacerExports;
      if (specifier === '../utils/perfMarks') return perfMarksExports;
      if (specifier === '../hooks/audioDelaySync') return audioDelayExports;
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

test('Linux paces frames: each is released on arrival and drawn from the refresh loop', async () => {
  const { api, receiver } = loadSandboxedPreload();
  let tick: ((now: number) => void) | null = null;
  const draws = { count: 0 };
  const unmount = mountVideoCanvas(api, {
    linux: true,
    draws,
    onAnimationFrame: (callback) => { tick = callback; },
  });
  let closedFrames = 0;
  try {
    for (let index = 0; index < 6; index++) {
      await receiver({ importedSharedTexture: {
        getVideoFrame: () => ({ codedWidth: 16, codedHeight: 16, close: () => { closedFrames++; } }) as VideoFrame,
        release() {},
      } }, { generation: 0, index });
    }
    // Released at once (the DMA-BUF slot goes back to mpv), not drawn yet.
    assert.equal(closedFrames, 6);
    assert.equal(draws.count, 0);
    assert.ok(tick, 'the canvas runs a refresh loop on Linux');
    const now = performance.now();
    for (let refresh = 0; refresh < 30; refresh++) (tick as (now: number) => void)(now + refresh * (1000 / 60));
    assert.ok(draws.count >= 4, `expected paced draws, got ${draws.count}`);
    assert.ok(draws.count <= 6);
  } finally {
    unmount();
  }
});
