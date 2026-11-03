import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from 'vitest/node';

/** Exercise the installed runner's public resolver, not copied implementation logic. */
describe('Vitest worker budget and serial fixtures', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('keeps serial database files in one worker despite a global worker budget', async () => {
    vi.stubEnv('VITEST_MAX_WORKERS', '2');
    const config = await resolveConfig({ config: false, watch: false, fileParallelism: false });
    expect(config.test.maxWorkers).toBe(1);
  });
  it('applies the budget to parallel files through the same normal configuration path', async () => {
    vi.stubEnv('VITEST_MAX_WORKERS', '2');
    const config = await resolveConfig({ config: false, watch: false, fileParallelism: true, maxWorkers: 4 });
    expect(config.test.maxWorkers).toBe(2);
  });
  it('keeps the serial invariant even when a project declares multiple workers', async () => {
    vi.stubEnv('VITEST_MAX_WORKERS', '2');
    const config = await resolveConfig({ config: false, watch: false, fileParallelism: false, maxWorkers: 4 });
    expect(config.test.maxWorkers).toBe(1);
  });
  it('validates inspector safety after applying the environment budget', async () => {
    vi.stubEnv('VITEST_MAX_WORKERS', '2');
    await expect(
      resolveConfig({ config: false, watch: false, fileParallelism: true, maxWorkers: 1, inspect: true })
    ).rejects.toThrow('--no-file-parallelism');
  });
});
