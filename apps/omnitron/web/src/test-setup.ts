// Global test setup for web tests
// This file is executed before all tests

import { cleanup } from '@aether/testing';
import { afterEach } from 'vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});
