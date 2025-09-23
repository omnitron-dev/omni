#!/usr/bin/env bun

/**
 * Bun test runner for netron package
 * This script helps run tests with Bun runtime
 */

import { resolve } from 'path';

// Check if running with Bun
if (typeof Bun === 'undefined') {
  console.error('This script must be run with Bun runtime');
  process.exit(1);
}

// Run all test files
const testPattern = process.argv[2] || 'test/**/*.spec.ts';

console.log(`Running tests with pattern: ${testPattern}`);
console.log('Bun version:', Bun.version);

// Execute tests
import(resolve(testPattern)).catch((error) => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
