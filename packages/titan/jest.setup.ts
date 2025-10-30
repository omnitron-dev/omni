import { jest } from '@jest/globals';

// Common test setup
jest.setTimeout(30000);

// Note: Global Redis setup moved to globalSetup.ts
// Individual tests can read Redis info from .redis-test-info.json if needed
