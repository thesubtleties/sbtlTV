import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listsOption } from './mpv-options.js';

const sample = [
  'Options:',
  '',
  ' --media-controls                 Choices: no player yes (default: player)',
  ' --media-title                    String (default: )',
  ' --mute                           Choices: no auto yes (default: no)',
].join('\r\n');

test('finds an option by its exact name, not a longer one that starts the same', () => {
  assert.equal(listsOption(sample, 'media-controls'), true);
  assert.equal(listsOption(sample, 'mute'), true);
  assert.equal(listsOption(sample, 'media'), false);
  assert.equal(listsOption(sample, 'force-media-title'), false);
  assert.equal(listsOption('', 'media-controls'), false);
});
