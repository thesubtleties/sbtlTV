// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppearanceTab, AppearanceOptions } from './AppearanceTab';
import { useUIStore } from '../../stores/uiStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement; let saved: unknown[];
const SETTINGS = { ...useUIStore.getState().settings };
beforeEach(() => {
  saved = [];
  Object.assign(window, { storage: { updateSettings: async (s: unknown) => { saved.push(s); return {}; } }, platform: { isLinux: true } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); useUIStore.setState({ settings: { ...SETTINGS } }); });

describe('Movies & Series header setting', () => {
  it('shows Simple by default and saves Floating with the rest of the look', async () => {
    await act(async () => root.render(createElement(AppearanceTab)));
    expect(host.textContent).toContain('Movies & Series header');
    expect(host.textContent).toContain('Categories as a row of tabs.');
    const floating = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Floating')!;
    await act(async () => floating.click());
    expect(useUIStore.getState().settings.appearance?.header).toBe('floating');
    expect(JSON.stringify(saved[saved.length - 1])).toContain('"header":"floating"');
    expect(host.textContent).toContain('A floating bar; categories in a Genres panel.');
  });

  it('is not part of first-run setup', async () => {
    await act(async () => root.render(createElement(AppearanceOptions)));
    expect(host.textContent).not.toContain('Movies & Series header');
  });
});
