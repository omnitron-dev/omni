import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  env: {} as { OMNITRON_DATABASE_URL?: string },
  migrate: vi.fn(), verify: vi.fn(), inspect: vi.fn(), create: vi.fn(),
  healthy: vi.fn(), image: vi.fn(), remove: vi.fn(), volume: vi.fn(),
  desired: { name: 'omnitron-pg', image: 'postgres:test', volumes: [{ source: 'omnitron-pg-data' }],
    labels: { 'omnitron.managed': 'true', 'omnitron.internal': 'true' } },
}));
vi.mock('../../src/shared/env-config.js', () => ({ getEnv: () => calls.env }));
vi.mock('../../src/database/migration-runner.js', () => ({
  runOmnitronMigrations: calls.migrate, assertOmnitronMigrationsCurrent: calls.verify,
}));
vi.mock('../../src/infrastructure/service-resolver.js', () => ({ resolveOmnitronPg: () => calls.desired }));
vi.mock('../../src/infrastructure/container-runtime.js', () => ({
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
    expect(calls.volume).toHaveBeenCalledWith('omnitron-pg-data');
    expect(calls.remove).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves the data volume and only replaces an owned disconnected container: %s', async detached => {
    const containerId = 'a'.repeat(64);
    calls.inspect.mockResolvedValue({ ...calls.desired, containerId, status: 'running', networkAttached: !detached });
    await prepareDaemonDatabase('master');
    if (detached) {
      expect(calls.remove).toHaveBeenCalledExactlyOnceWith(containerId);
      expect(calls.create).toHaveBeenCalledExactlyOnceWith(calls.desired);
    } else {
      expect(calls.remove).not.toHaveBeenCalled();
      expect(calls.create).not.toHaveBeenCalled();
    }
    expect(calls.migrate).toHaveBeenCalledOnce();
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
