import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIpCheck } from './ip-check.js';

test('ip check: keeps the IP, place, network and Mullvad status, never the coordinates', () => {
  const result = parseIpCheck({
    ip: '203.0.113.7', country: 'USA', city: 'San Jose, CA', latitude: 37.3, longitude: -121.9,
    organization: 'Tzulo', mullvad_exit_ip: true, mullvad_exit_ip_hostname: 'us-sjc-wg-504', mullvad_server_type: 'WireGuard',
  });
  assert.deepEqual(result, { ip: '203.0.113.7', city: 'San Jose, CA', country: 'USA', organization: 'Tzulo', mullvadServer: 'us-sjc-wg-504' });
});

test('ip check: not on Mullvad, missing place', () => {
  assert.deepEqual(parseIpCheck({ ip: '198.51.100.2', country: 'USA', organization: 'Comcast Cable', mullvad_exit_ip: false }),
    { ip: '198.51.100.2', city: null, country: 'USA', organization: 'Comcast Cable', mullvadServer: null });
});

test('ip check: anything that is not an answer with an IP is refused', () => {
  for (const bad of [null, 'x', {}, { ip: 5 }, { ip: '' }]) assert.equal(parseIpCheck(bad), null);
});
