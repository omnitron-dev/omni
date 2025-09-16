/**
 * Deno test runner for all @omnitron-dev/nexus tests
 * This file imports and runs all *.spec.ts tests
 */

import '@omnitron-dev/testing/runtime/deno';

// Import all test files
import '../core/container.spec.ts';
import '../core/token.spec.ts';
import '../modules/module-system.spec.ts';
import '../plugins/plugin-middleware.spec.ts';
import '../async/async-operations.spec.ts';
import '../testing/testing-utilities.spec.ts';
import '../advanced/decorators.spec.ts';
import '../advanced/custom-decorators.spec.ts';
import '../advanced/federation-mesh.spec.ts';
import '../advanced/tracing-devtools.spec.ts';
import '../utils/runtime.spec.ts';

// Deno-specific runtime tests
Deno.test('should detect Deno runtime', () => {
  if (typeof Deno === 'undefined') {
    throw new Error('Deno runtime not detected');
  }
  if (!Deno.version) {
    throw new Error('Deno version not found');
  }
});

Deno.test('should have Deno-specific APIs', () => {
  if (typeof Deno.readTextFile !== 'function') {
    throw new Error('Deno.readTextFile not available');
  }
  if (typeof Deno.writeTextFile !== 'function') {
    throw new Error('Deno.writeTextFile not available');
  }
});

Deno.test('should support Deno.env', () => {
  if (!Deno.env) {
    throw new Error('Deno.env not available');
  }
});