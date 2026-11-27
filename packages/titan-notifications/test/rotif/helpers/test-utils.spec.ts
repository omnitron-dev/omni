import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { getTestRedisUrl } from './test-utils.js';

it('keeps destructive Rotif tests on the Redis selected by their isolated setup', () => {
  const info = JSON.parse(readFileSync(process.env.TITAN_TEST_REDIS_INFO!, 'utf8'));
  expect(info.isNative || info.isDocker || info.isMock).toBe(true);
  vi.stubEnv('REDIS_URL', 'redis://elsewhere.invalid:6379');
  vi.stubEnv('TEST_REDIS_URL', 'redis://another-suite.invalid:16379');
  try {
    expect(getTestRedisUrl()).toBe(info.url);
  } finally {
    vi.unstubAllEnvs();
  }
});
