import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLineBuffer } from './line-buffer.js';
import { redactUrls } from './log-redact.js';

test('line buffer: a link split across chunks is redacted as one line', () => {
  const lines: string[] = [];
  const buffer = createLineBuffer((line) => lines.push(redactUrls(line)));
  buffer.push('Opening http://provider.example/live/bo');
  buffer.push('b/s3cret/1.ts\nnext line\r\npart');
  assert.deepEqual(lines, ['Opening http://provider.example/…', 'next line']);
  buffer.flush();
  assert.deepEqual(lines, ['Opening http://provider.example/…', 'next line', 'part']);
});

test('line buffer: empty lines are skipped, and a very long line without a newline is handed on', () => {
  const lines: string[] = [];
  const buffer = createLineBuffer((line) => lines.push(line));
  buffer.push('\n\n   \n');
  assert.deepEqual(lines, []);
  buffer.push('x'.repeat(70 * 1024));
  assert.equal(lines.length, 1);
});
