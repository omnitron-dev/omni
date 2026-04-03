/**
 * Bun test runner for all @devgrid/eventemitter tests
 * This file imports and runs all *.spec.ts tests
 * Note: bun-setup.ts is preloaded via bunfig.toml
 */

import { describe, test, expect } from 'bun:test';

// Import all test files
import '../browser-compat.spec';
import '../concurrency.spec';
import '../enhanced-emitter.spec';
import '../eventemitter.spec';
import '../history.spec';
import '../index.spec';
import '../metrics.spec';
import '../regression.spec';
import '../scheduler.spec';
import '../scheduler-error-handling.spec';
import '../wildcard.spec';
import '../wildcard-edge-cases.spec';

// Bun-specific runtime tests
describe('@devgrid/eventemitter Bun Runtime', () => {
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
