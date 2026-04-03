/**
 * Test utilities for cross-runtime support
 *
 * This file is used as a bun test preload (see bunfig.toml).
 * It re-exports from @omnitron-dev/testing when available.
 */

try {
  // Re-export from @omnitron-dev/testing to ensure consistency

  const testing = require('@omnitron-dev/testing');
  Object.assign(module.exports, testing);
} catch {
  // Module not available in this runtime context (e.g., bun without full pnpm workspace linking)
}
