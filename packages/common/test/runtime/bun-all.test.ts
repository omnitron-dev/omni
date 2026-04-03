/**
 * Bun test runner for all @omnitron-dev/common tests
 * This file imports and runs all *.spec.ts tests
 */

import '@omnitron-dev/testing/runtime/bun';
import { describe, test, expect } from 'bun:test';

// Import all test files
import '../entries.spec';
import '../list-buffer.spec';
import '../omit.spec';
import '../p-limit.spec';
import '../predicates.spec';
import '../primitives.spec';
import '../promise.spec';
import '../timed-map.spec';

// Bun-specific runtime tests
describe('@omnitron-dev/common Bun Runtime', () => {
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
