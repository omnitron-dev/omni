/**
 * Bun test runner for @omnitron-dev/nexus
 * Runs tests that are compatible with Bun runtime
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

// Set up globals that tests might expect
global.beforeEach = beforeEach;
global.afterEach = afterEach;
global.describe = describe;
global.test = test;
global.it = test;
global.expect = expect;

// Import test files that don't have compatibility issues
import '../core/container.spec.js';
import '../core/token.spec.js';
import '../modules/module-system.spec.js';
import '../plugins/plugin-middleware.spec.js';
import '../testing/testing-utilities.spec.js';
import '../utils/runtime.spec.js';
// Skip custom-decorators and others that have issues with type exports
// import '../advanced/decorators.spec.js';
// import '../advanced/custom-decorators.spec.js';
// import '../advanced/federation-mesh.spec.js';
// import '../advanced/tracing-devtools.spec.js';
// import '../async/async-operations.spec.js';

// Bun-specific runtime tests
describe('@omnitron-dev/nexus Bun Runtime', () => {
  test('should detect Bun runtime', () => {
    expect(typeof Bun).toBe('object');
    expect(Bun.version).toBeDefined();
  });

  test('should have Bun-specific APIs', () => {
    expect(typeof Bun.file).toBe('function');
    expect(typeof Bun.write).toBe('function');
  });

  test('should support Bun.env', () => {
    expect(Bun.env).toBeDefined();
  });
});