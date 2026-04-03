/**
 * Shared test environment configuration.
 *
 * All test infrastructure ports default to docker-compose.test.yml values
 * (non-standard ports to avoid collisions with local services).
 * Override via environment variables.
 */

export const TEST_REDIS_HOST = process.env['TEST_REDIS_HOST'] ?? 'localhost';
export const TEST_REDIS_PORT = Number(process.env['TEST_REDIS_PORT'] ?? 16379);
export const TEST_REDIS_URL = process.env['TEST_REDIS_URL'] ?? `redis://${TEST_REDIS_HOST}:${TEST_REDIS_PORT}`;

export const TEST_POSTGRES_HOST = process.env['TEST_POSTGRES_HOST'] ?? 'localhost';
export const TEST_POSTGRES_PORT = Number(process.env['TEST_POSTGRES_PORT'] ?? 15432);
export const TEST_POSTGRES_USER = process.env['TEST_POSTGRES_USER'] ?? 'test';
export const TEST_POSTGRES_PASSWORD = process.env['TEST_POSTGRES_PASSWORD'] ?? 'test';
export const TEST_POSTGRES_DB = process.env['TEST_POSTGRES_DB'] ?? 'test';
export const TEST_POSTGRES_URL =
  process.env['TEST_POSTGRES_URL'] ??
  `postgresql://${TEST_POSTGRES_USER}:${TEST_POSTGRES_PASSWORD}@${TEST_POSTGRES_HOST}:${TEST_POSTGRES_PORT}/${TEST_POSTGRES_DB}`;

/** Build a Redis URL for a specific DB index */
export function testRedisUrl(db = 0): string {
  return `${TEST_REDIS_URL}/${db}`;
}

/** Build a Postgres URL for a specific database name */
export function testPostgresUrl(database?: string): string {
  const db = database ?? TEST_POSTGRES_DB;
  return `postgresql://${TEST_POSTGRES_USER}:${TEST_POSTGRES_PASSWORD}@${TEST_POSTGRES_HOST}:${TEST_POSTGRES_PORT}/${db}`;
}
