import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// These hops run only inside Electron and a utility process, so no unit test reaches them.
// Each is one line, and losing any of them means a silent empty guide or a setting that forgets.
const source = (file: string) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');

test('a data reset travels worker -> data process -> host -> main -> renderer', () => {
  assert.match(source('data/sync-worker.ts'), /onReset: \(reason\) => post\(\{ type: 'reset', reason \}\)/);
  assert.match(source('data/data-process.ts'), /case 'reset': tell\(\{ type: 'reset'/);
  assert.match(source('data/data-host.ts'), /case 'reset':.*opts\.onStatus\('reset'\)/);
  assert.match(source('data/data-host.ts'), /case 'fatal':.*opts\.onStatus\('fatal'\)/);
  const main = source('main.ts');
  assert.match(main, /onStatus: \(status\) => \{ dataStatus = status; sendToRenderer\('data-status', status\); \}/);
  assert.match(main, /ipcMain\.handle\('data-status', \(\) => \{/);
  assert.match(main, /if \(status === 'reset'\) dataStatus = null/);
  const preload = source('preload.cts');
  assert.match(preload, /ipcRenderer\.invoke\('data-status'\)/);
  assert.match(preload, /ipcRenderer\.on\('data-status', listener\)/);
});

test('the guide search setting is saved and read back', () => {
  const storage = source('storage.ts');
  assert.match(storage, /updated\.guideSearchHideAdult = settings\.guideSearchHideAdult/);
  assert.match(storage, /result\.guideSearchHideAdult = stored\.guideSearchHideAdult \?\? false/);
});
