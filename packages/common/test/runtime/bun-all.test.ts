/**
 * Bun test runner for all @omnitron-dev/common tests
 * This file imports and runs all *.spec.ts tests
 */

// Relative, and to the SOURCE, on purpose. Declaring `@omnitron-dev/testing`
// as a dependency of `common` closes a build cycle — testing depends on titan,
// titan on common — and turbo then refuses to build anything at all. A runner's
// need for an adapter must not become an edge in the build graph, so it is
// resolved the way the Deno runner resolves it: outside that graph. Source
// rather than dist for the same reason — no build ordering to get wrong.
import '../../../testing/src/runtime/bun-adapter.ts';
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
