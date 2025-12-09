import { jest, afterAll } from '@jest/globals';

// Make jest available globally for source files that need it
(global as any).jest = jest;

// Common test setup
jest.setTimeout(30000);

// Force exit after tests - give a small delay for cleanup
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));
