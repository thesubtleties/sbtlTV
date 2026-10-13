import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveSettings } from './saveSettings';
import { useToastStore } from '../stores/toastStore';

const updateSettings = vi.fn();

beforeEach(() => {
  updateSettings.mockReset();
  (globalThis as unknown as { window: unknown }).window = { storage: { updateSettings }, debug: undefined };
  useToastStore.setState({ toasts: [] });
});

describe('saveSettings', () => {
  it('says nothing when the settings were stored', async () => {
    updateSettings.mockResolvedValue({ success: true });
    await saveSettings({ subtitles: { liveDefault: true, vodDefault: false, size: 'medium', style: 'outline', language: 'auto' } });
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('tells the user when main could not store them', async () => {
    updateSettings.mockResolvedValue({ error: 'EACCES' });
    await saveSettings({ subtitles: { liveDefault: true, vodDefault: false, size: 'medium', style: 'outline', language: 'auto' } });
    expect(useToastStore.getState().toasts.map((t) => [t.kind, t.title])).toEqual([['error', 'Setting not saved']]);
  });

  it('tells the user when the call itself fails', async () => {
    updateSettings.mockRejectedValue(new Error('IPC gone'));
    await saveSettings({});
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});
