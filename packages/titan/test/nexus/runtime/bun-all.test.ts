/**
 * Bun test runner for all @omnitron-dev/nexus tests
 * This file imports and runs all *.spec.ts tests
 */

import '@omnitron-dev/testing/runtime/bun';
import { describe, test, expect } from 'bun:test';

// Import all test files
import '../core/container.spec';
import '../core/token.spec';
import '../modules/module-system.spec';
import '../plugins/plugin-middleware.spec';
import '../async/async-operations.spec';
import '../testing/testing-utilities.spec';
import '../advanced/decorators.spec';
import '../advanced/custom-decorators.spec';
import '../advanced/federation-mesh.spec';
import '../advanced/tracing-devtools.spec';
import '../utils/runtime.spec';

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
