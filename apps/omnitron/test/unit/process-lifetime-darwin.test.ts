import { afterEach, expect, it, vi } from 'vitest';
import { readProcessLifetime } from '../../src/monitoring/process-lifetime.js';
import { compareProcessLifetimes } from '../../src/shared/host-boot-identity.js';

afterEach(() => vi.unstubAllEnvs());

it.skipIf(process.platform !== 'darwin')('reads the same live native process independently of the observer timezone', () => {
  vi.stubEnv('TZ', 'UTC');
  const first = readProcessLifetime(process.pid);
  vi.stubEnv('TZ', 'America/New_York');
  const second = readProcessLifetime(process.pid);
  expect(first.state).toBe('alive'); expect(second.state).toBe('alive');
  if (first.state !== 'alive' || second.state !== 'alive') throw Error('Native process identity unavailable');
  expect(second.identity).toBe(first.identity);
  expect(first.identity).toMatch(/^darwin:[a-f0-9-]{36}:utc:/);
  expect(compareProcessLifetimes(first.identity, second.identity)).toBe('same');
});
