import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './uiStore';

// Snapshot the default settings so each test starts clean.
const DEFAULTS = { ...useUIStore.getState().settings };
const reset = () => useUIStore.setState({ settings: { ...DEFAULTS } });

describe('uiStore settings — channelColumnWidth', () => {
  beforeEach(reset);

  it('defaults to 300', () => {
    expect(useUIStore.getState().settings.channelColumnWidth).toBe(300);
  });

  it('clamps below the minimum to 220', () => {
    useUIStore.getState().updateSettings({ channelColumnWidth: 100 });
    expect(useUIStore.getState().settings.channelColumnWidth).toBe(220);
  });

  it('clamps above the maximum to 520', () => {
    useUIStore.getState().updateSettings({ channelColumnWidth: 999 });
    expect(useUIStore.getState().settings.channelColumnWidth).toBe(520);
  });

  it('leaves an in-range value unchanged', () => {
    useUIStore.getState().updateSettings({ channelColumnWidth: 360 });
    expect(useUIStore.getState().settings.channelColumnWidth).toBe(360);
  });
});
