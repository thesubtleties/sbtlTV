import { describe, it, expect } from 'vitest';
import { onceEachStatus, watchDataStatus, type DataStatus } from './dataStatus';

describe('onceEachStatus', () => {
  it('tells once, when the startup check and the event both report it', () => {
    const told: string[] = [];
    const show = onceEachStatus((s) => told.push(s));
    show('reset');
    show('reset');
    expect(told).toEqual(['reset']);
  });
  it('still tells a different status, and ignores none', () => {
    const told: string[] = [];
    const show = onceEachStatus((s) => told.push(s));
    show(null);
    show('reset');
    show('fatal');
    expect(told).toEqual(['reset', 'fatal']);
  });
});

describe('watchDataStatus', () => {
  const source = (first: Promise<DataStatus | null>) => {
    let emit: (s: DataStatus) => void = () => {};
    let stopped = false;
    return { status: () => first, onStatus: (cb: (s: DataStatus) => void) => { emit = cb; return () => { stopped = true; }; }, emit: (s: DataStatus) => emit(s), stopped: () => stopped };
  };
  it('tells a status from before the window existed', async () => {
    const told: string[] = [];
    watchDataStatus(source(Promise.resolve('reset')), (s) => told.push(s));
    await Promise.resolve();
    expect(told).toEqual(['reset']);
  });
  it('tells a live status, and the same one from both ways only once', async () => {
    const told: string[] = [];
    const s = source(Promise.resolve('reset'));
    watchDataStatus(s, (x) => told.push(x));
    s.emit('reset');
    await Promise.resolve();
    expect(told).toEqual(['reset']);
    s.emit('fatal');
    expect(told).toEqual(['reset', 'fatal']);
  });
  it('still listens when the startup check fails, and stops when asked', async () => {
    const told: string[] = [];
    const s = source(Promise.reject(new Error('no')));
    const stop = watchDataStatus(s, (x) => told.push(x));
    await Promise.resolve();
    s.emit('fatal');
    expect(told).toEqual(['fatal']);
    stop?.();
    expect(s.stopped()).toBe(true);
  });
  it('does nothing outside the app', () => {
    expect(watchDataStatus(undefined, () => {})).toBeUndefined();
  });
});
