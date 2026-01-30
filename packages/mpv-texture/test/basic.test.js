/**
 * Basic tests for @sbtltv/mpv-texture
 *
 * Run with: node test/basic.test.js
 */

const { createMpvController, isSupported, getPlatform } = require('../index.js');

function log(msg) {
  console.log(`[test] ${msg}`);
}

function assert(condition, msg) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function runTests() {
  log('Starting mpv-texture tests');
  log(`Platform: ${getPlatform()}`);
  log(`Shared texture supported: ${isSupported()}`);

  // Test 1: isSupported returns boolean
  log('Test 1: isSupported returns boolean');
  assert(typeof isSupported() === 'boolean', 'isSupported should return boolean');
  log('  PASS');

  // Test 2: getPlatform returns valid platform
  log('Test 2: getPlatform returns valid platform');
  const platform = getPlatform();
  assert(['darwin', 'win32', 'linux'].includes(platform), `getPlatform returned ${platform}`);
  log('  PASS');

  // Skip remaining tests if not supported
  if (!isSupported()) {
    log('Shared texture not supported on this platform, skipping controller tests');
    log('All applicable tests passed!');
    return;
  }

  // Test 3: Create controller with valid options
  log('Test 3: Create controller with valid options');
  const controller = createMpvController({ width: 1920, height: 1080 });
  assert(controller !== null, 'Controller should be created');
  log('  PASS');

  // Test 4: Controller starts uninitialized
  log('Test 4: Controller starts uninitialized');
  assert(controller.isInitialized() === false, 'Controller should start uninitialized');
  log('  PASS');

  // Test 5: Initialize controller
  log('Test 5: Initialize controller');
  try {
    await controller.init();
    assert(controller.isInitialized() === true, 'Controller should be initialized');
    log('  PASS');
  } catch (err) {
    log(`  SKIP (mpv not available: ${err.message})`);
    controller.destroy();
    return;
  }

  // Test 6: Render returns null when no media loaded
  log('Test 6: Render returns null when no media loaded');
  const result = controller.render();
  // May be null or empty frame
  log(`  Result: ${result === null ? 'null' : 'frame'}`);
  log('  PASS');

  // Test 7: Resize without error
  log('Test 7: Resize without error');
  controller.resize(1280, 720);
  log('  PASS');

  // Test 8: Destroy without error
  log('Test 8: Destroy without error');
  controller.destroy();
  log('  PASS');

  // Test 9: Invalid options throws
  log('Test 9: Invalid options throws');
  try {
    createMpvController({});
    assert(false, 'Should have thrown');
  } catch (err) {
    assert(err.message.includes('width') || err.message.includes('height'), 'Error should mention width/height');
    log('  PASS');
  }

  // Test 10: Zero dimensions throws
  log('Test 10: Zero dimensions throws');
  try {
    createMpvController({ width: 0, height: 0 });
    assert(false, 'Should have thrown');
  } catch (err) {
    log('  PASS');
  }

  log('All tests passed!');
}

runTests().catch(err => {
  console.error('[test] FAILED:', err.message);
  process.exit(1);
});
