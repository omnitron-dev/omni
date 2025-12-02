import { jest } from '@jest/globals';
import 'reflect-metadata';

// Make jest available globally for source files that need it
(global as any).jest = jest;

// Common test setup
jest.setTimeout(30000);

// Note: Global Redis setup moved to globalSetup.ts
// Individual tests can read Redis info from .redis-test-info.json if needed
