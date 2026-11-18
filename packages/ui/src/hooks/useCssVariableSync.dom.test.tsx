// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useCssVariableSync } from './useCssVariableSync';
import { useUIStore } from '../stores/uiStore';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SETTINGS = { ...useUIStore.getState().settings };
afterEach(() => useUIStore.setState({ settings: { ...SETTINGS } }));

it('the Movies & Series header setting switches data-vod-header (Simple when unset)', async () => {
  function Sync() { useCssVariableSync(); return null; }
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(createElement(Sync)));
  expect(document.documentElement.dataset.vodHeader).toBe('simple');
  await act(async () => useUIStore.setState((s) => ({ settings: { ...s.settings, appearance: { palette: 'sbtl', typeface: 'fira', accent: 'palette', header: 'floating' } } })));
  expect(document.documentElement.dataset.vodHeader).toBe('floating');
  await act(async () => root.unmount());
});
