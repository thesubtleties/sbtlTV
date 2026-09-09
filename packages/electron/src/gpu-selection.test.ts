import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectChromiumGpuIdentity } from './gpu-selection.js';

const hybridDevices = [
  { active: true, vendorId: 0x1002, deviceId: 0x13c0 },
  { active: false, vendorId: 0x10de, deviceId: 0x2f04 },
];

test('selects the GPU used by the high-performance WebGL consumer', () => {
  assert.deepEqual(
    selectChromiumGpuIdentity(hybridDevices, {
      vendor: 'Google Inc. (NVIDIA Corporation)',
      renderer: 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX)',
    }),
    { vendorId: 0x10de, deviceId: 0x2f04, source: 'webgl' }
  );
});

test('falls back to Chromium active GPU when WebGL vendor is unavailable', () => {
  assert.deepEqual(
    selectChromiumGpuIdentity(hybridDevices, null),
    { vendorId: 0x1002, deviceId: 0x13c0, source: 'active' }
  );
});

test('accepts hexadecimal GPU IDs returned as strings', () => {
  assert.deepEqual(
    selectChromiumGpuIdentity(
      [{ active: true, vendorId: '0x8086', deviceId: '0x1234' }],
      { vendor: 'Intel Inc.', renderer: 'Mesa Intel Graphics' }
    ),
    { vendorId: 0x8086, deviceId: 0x1234, source: 'webgl' }
  );
});
