/**
 * Database Testing Utilities
 *
 * Comprehensive utilities for testing database operations with support for:
 * - Automatic transaction rollback
 * - Test data seeding
 * - Database cleanup strategies
 * - Docker-based real database testing
 * - SQLite in-memory fallback
 */

export {
  DatabaseTestingModule,
  DatabaseTestingService,
  type DatabaseTestingOptions,
} from './database-testing.module.js';

export {
  createTestDatabase,
  withTestDatabase,
  createTestDatabaseConfigs,
  cleanupTestDatabaseConfigs,
  getRecommendedTestDatabase,
  isDockerAvailable,
  type DatabaseTestOptions,
  type DatabaseTestContext,
} from './test-utilities.js';

// Re-export DATABASE_TESTING_SERVICE from the testing module
export { DATABASE_TESTING_SERVICE } from './database-testing.module.js';
