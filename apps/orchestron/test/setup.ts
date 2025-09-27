import { afterEach, beforeEach, vi } from 'vitest';
import { cleanupTestContext } from './fixtures/test-helpers.js';

beforeEach(async () => {
  delete process.env.TEST_DB_PATH;
  vi.clearAllMocks();
});

afterEach(async () => {
  await cleanupTestContext();
  vi.restoreAllMocks();
});