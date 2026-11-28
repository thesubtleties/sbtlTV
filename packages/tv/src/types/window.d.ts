// The shared clients check `typeof window !== 'undefined' && window.fetchProxy` (the desktop renderer's IPC proxy).
// React Native's types have no DOM, so declare the little they read; at runtime RN defines window as the global.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: typeof globalThis & { fetchProxy?: any };
