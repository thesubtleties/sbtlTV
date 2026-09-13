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

const sameVendorDevices = [
  { active: true, vendorId: 0x1002, deviceId: 0x164e },
  { active: false, vendorId: 0x1002, deviceId: 0x744c },
];

test('matches the WebGL device ID when multiple GPUs share a vendor', () => {
  assert.deepEqual(
    selectChromiumGpuIdentity(sameVendorDevices, {
      vendor: 'Google Inc. (AMD)',
      renderer: 'ANGLE (AMD, AMD Radeon RX 7900 XTX (0x0000744C), OpenGL)',
    }),
    { vendorId: 0x1002, deviceId: 0x744c, source: 'webgl' }
  );
});

test('rejects ambiguous or unmatched WebGL devices instead of guessing', () => {
  for (const renderer of [
    'ANGLE (AMD, AMD Radeon Graphics, OpenGL)',
    'ANGLE (AMD, AMD Radeon Graphics (0x00009999), OpenGL)',
  ]) {
    assert.throws(
      () => selectChromiumGpuIdentity(sameVendorDevices, { vendor: 'AMD', renderer }),
      /Cannot uniquely identify Chromium's WebGL GPU/
    );
  }
});

test('rejects two physical GPUs with identical vendor and device IDs', () => {
  assert.throws(
    () => selectChromiumGpuIdentity([sameVendorDevices[1], sameVendorDevices[1]], {
      vendor: 'AMD', renderer: 'ANGLE (AMD, Radeon (0x0000744C), OpenGL)',
    }),
    /Cannot uniquely identify Chromium's WebGL GPU/
  );
});
