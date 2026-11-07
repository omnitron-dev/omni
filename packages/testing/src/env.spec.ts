import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it('keeps an explicit PostgreSQL endpoint when selecting a test database', async () => {
  const endpoint = 'postgresql://tester:encoded%40secret@127.0.0.1:25432/source?sslmode=require';
  vi.stubEnv('TEST_POSTGRES_URL', endpoint);
  vi.stubEnv('TEST_DATABASE_URL', 'postgresql://unused:unused@127.0.0.1:15432/unused');
  const { TEST_POSTGRES_URL, testPostgresUrl } = await import('./env.js');
  expect(TEST_POSTGRES_URL).toBe(endpoint);
  expect(testPostgresUrl()).toBe(endpoint);
  expect(testPostgresUrl('worker/2')).toBe('postgresql://tester:encoded%40secret@127.0.0.1:25432/worker%2F2?sslmode=require');
});

it('resolves the existing CI database variable in the shared environment', async () => {
  vi.stubEnv('TEST_POSTGRES_URL', undefined);
  vi.stubEnv('TEST_DATABASE_URL', 'postgresql://tester:secret@127.0.0.1:35432/ci');
  const { TEST_POSTGRES_URL } = await import('./env.js');
  expect(TEST_POSTGRES_URL).toBe('postgresql://tester:secret@127.0.0.1:35432/ci');
});
