import 'reflect-metadata';

// Global test setup for backend tests
// This file is executed before all tests

// Set test environment
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';

// Extend Jest timeout for integration tests
jest.setTimeout(30000);
