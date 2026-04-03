#!/usr/bin/env node
/**
 * Prism CLI Entry Point
 *
 * @module @omnitron-dev/prism/cli
 */

import('../dist/cli/index.js').then(({ cli }) => {
  cli().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
});
