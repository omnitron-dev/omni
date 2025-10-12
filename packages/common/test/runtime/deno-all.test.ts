/**
 * Deno test runner for all @omnitron-dev/common tests
 * This file imports and runs all *.spec.ts tests
 */

import '@omnitron-dev/testing/runtime/deno';
import { describe, it, expect } from '@omnitron-dev/testing/runtime/deno';

// Import all test files
// Order matters - tests with timers/promises should be last
import '../entries.spec.ts';
import '../list-buffer.spec.ts';
import '../omit.spec.ts';
import '../predicates.spec.ts';
import '../primitives.spec.ts';
import '../timed-map.spec.ts';
// TODO: Fix p-limit.spec.ts for Deno - mock issues
// import '../p-limit.spec.ts';
import '../promise.spec.ts';

// Deno-specific runtime tests
describe('@omnitron-dev/common Deno Runtime', () => {
  it('should detect Deno runtime', () => {
    expect(typeof Deno).toBe('object');
    expect(Deno.version).toBeDefined();
  });

  it('should have Deno-specific APIs', () => {
    expect(typeof Deno.readFile).toBe('function');
    expect(typeof Deno.writeFile).toBe('function');
  });

  it('should support Deno.env', () => {
    expect(Deno.env).toBeDefined();
  });
});
