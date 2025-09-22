import { jest } from '@jest/globals';

// Common test setup
jest.setTimeout(30000);

// Removed afterAll hook as it causes timeout issues
// Jest will handle cleanup automatically