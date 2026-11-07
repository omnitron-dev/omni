import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { requiresTestPostgres } from './requires-test-postgres.js';

const fixture = vi.hoisted(() => ({ execute: vi.fn(), destroy: vi.fn() }));
vi.mock('kysely', () => ({ sql: () => ({ execute: fixture.execute }) }));
vi.mock('../../src/database/connection.js', () => ({
  createOmnitronDb: async () => ({ destroy: fixture.destroy }),
}));
vi.mock('../../src/shared/env-config.js', () => ({ resetEnvCache: vi.fn(), setEnvOverride: vi.fn() }));
beforeEach(() => { fixture.execute.mockReset(); fixture.destroy.mockReset().mockResolvedValue(undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it.each(['true', '1'])('fails CI=%s rather than passing with an unavailable database suite', async value => {
  vi.stubEnv('CI', value);
  const error = Error('database unavailable');
  fixture.execute.mockRejectedValue(error);
  await expect(requiresTestPostgres('postgresql://test:test@127.0.0.1:15432/test'))
    .rejects.toMatchObject({ message: expect.stringContaining('cannot be skipped'), cause: error });
  expect(fixture.destroy).toHaveBeenCalledOnce();
});

it('explains unavailable local integration tests and closes their probe', async () => {
  vi.stubEnv('CI', undefined);
  fixture.execute.mockRejectedValue(Error('connection refused'));
  const output = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  expect(await requiresTestPostgres('postgresql://test:test@127.0.0.1:15432/test'))
    .toMatchObject({ ok: false, reason: 'connection refused' });
  expect(output).toHaveBeenCalledWith(expect.stringContaining('NOT RUN'));
  expect(fixture.destroy).toHaveBeenCalledOnce();
});
