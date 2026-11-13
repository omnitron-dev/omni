import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  env: {} as { OMNITRON_DATABASE_URL?: string },
  migrate: vi.fn(), verify: vi.fn(), inspect: vi.fn(), create: vi.fn(),
  healthy: vi.fn(), start: vi.fn(), image: vi.fn(), remove: vi.fn(), volume: vi.fn(),
  desired: { name: 'omnitron-pg', image: 'postgres:test', volumes: [{ source: 'omnitron-pg-data' }],
    labels: { 'omnitron.managed': 'true', 'omnitron.internal': 'true' } },
}));
vi.mock('../../src/shared/env-config.js', () => ({ getEnv: () => calls.env }));
vi.mock('../../src/database/migration-runner.js', () => ({
  runOmnitronMigrations: calls.migrate, assertOmnitronMigrationsCurrent: calls.verify,
}));
vi.mock('../../src/infrastructure/service-resolver.js', () => ({ resolveOmnitronPg: () => calls.desired }));
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...await original<typeof import('../../src/infrastructure/container-runtime.js')>(), startContainer: calls.start,
  createContainer: calls.create, getContainerState: calls.inspect, waitForHealthy: calls.healthy,
  ensureImage: calls.image, removeContainer: calls.remove, createVolume: calls.volume,
}));
import { prepareDaemonDatabase } from '../../src/daemon/database-startup.js';

beforeEach(() => {
  vi.resetAllMocks();
  calls.env = {};
  calls.inspect.mockResolvedValue(null);
  calls.healthy.mockResolvedValue(true);
});

describe('control-plane database startup admission', () => {
  it('keeps a slave independent of PostgreSQL and Docker', async () => {
    await prepareDaemonDatabase('slave');
    expect(calls.inspect).not.toHaveBeenCalled();
    expect(calls.migrate).not.toHaveBeenCalled();
    expect(calls.verify).not.toHaveBeenCalled();
  });

  it.each([{ noInfra: true }, { external: true }])('migrates a supplied database without provisioning Docker: %j', async mode => {
    if ('external' in mode) calls.env.OMNITRON_DATABASE_URL = 'postgresql://fixture.invalid/isolated';
    await prepareDaemonDatabase('master', { noInfra: 'noInfra' in mode });
    expect(calls.inspect).not.toHaveBeenCalled();
    expect(calls.migrate).toHaveBeenCalledOnce();
    expect(calls.verify).not.toHaveBeenCalled();
  });

  it('verifies a replacement before any provider can mutate the old schema', async () => {
    const failure = new Error('Backend schema is not ready: pending migration');
    calls.verify.mockRejectedValue(failure);
    await expect(prepareDaemonDatabase('master', { handoff: true })).rejects.toBe(failure);
    expect(calls.verify).toHaveBeenCalledOnce();
    expect(calls.inspect).not.toHaveBeenCalled();
    expect(calls.migrate).not.toHaveBeenCalled();
  });

  it('waits for database health before applying the shared migration registry', async () => {
    const events: string[] = [];
    calls.create.mockImplementation(async () => { events.push('container'); });
    calls.healthy.mockImplementation(async () => { events.push('healthy'); return true; });
    calls.migrate.mockImplementation(async () => { events.push('schema'); });
    await prepareDaemonDatabase('master');
    expect(events).toEqual(['container', 'healthy', 'schema']);
    expect(calls.create).toHaveBeenCalledExactlyOnceWith(calls.desired);
    expect(calls.remove).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps a retained database and reports a detached network before migration: %s', async detached => {
    const containerId = 'a'.repeat(64);
    calls.inspect.mockResolvedValue({ ...calls.desired, containerId, status: 'running', networkAttached: !detached });
    if (detached) await expect(prepareDaemonDatabase('master')).rejects.toThrow('requires a reviewed replacement');
    else await prepareDaemonDatabase('master');
    expect(calls.remove).not.toHaveBeenCalled(); expect(calls.create).not.toHaveBeenCalled();
    expect(calls.migrate).toHaveBeenCalledTimes(detached ? 0 : 1);
  });

  it('refuses a foreign allocation without removing it or applying migrations', async () => {
    calls.inspect.mockResolvedValue({ ...calls.desired, containerId: 'b'.repeat(64), labels: {}, status: 'exited' });
    await expect(prepareDaemonDatabase('master')).rejects.toThrow('another allocation');
    expect(calls.remove).not.toHaveBeenCalled();
    expect(calls.migrate).not.toHaveBeenCalled();
  });

  it('does not declare startup ready after a failed health check', async () => {
    calls.healthy.mockResolvedValue(false);
    await expect(prepareDaemonDatabase('master')).rejects.toThrow('did not become healthy');
    expect(calls.migrate).not.toHaveBeenCalled();
  });

  it('propagates migration failure instead of admitting a partially initialized master', async () => {
    const failure = new Error('migration checksum changed');
    calls.migrate.mockRejectedValue(failure);
    await expect(prepareDaemonDatabase('master', { noInfra: true })).rejects.toBe(failure);
  });
});
