import { beforeEach, describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({
  config: vi.fn(), admit: vi.fn(), inspect: vi.fn(), stop: vi.fn(), remove: vi.fn(),
}));
vi.mock('../../src/cluster/standalone-infrastructure.js', () => ({ assertStandaloneInfrastructure: runtime.admit }));
vi.mock('../../src/config/loader.js', () => ({ loadEcosystemConfig: runtime.config }));
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...(await original<Record<string, unknown>>()), listManagedContainers: runtime.inspect,
  stopContainer: runtime.stop, removeContainer: runtime.remove,
}));
import { infraDownCommand, infraResetCommand, infraUpCommand } from '../../src/commands/infra.js';

const spec = { apps: [], infrastructure: { redis: {} } };
const cache = { name: 'omnitron-redis', image: 'redis', status: 'running', containerId: 'd'.repeat(64),
  labels: { 'omnitron.managed': 'true', 'omnitron.service': 'redis' } };
beforeEach(() => { vi.resetAllMocks(); runtime.config.mockResolvedValue(spec); });
describe('standalone infrastructure CLI', () => {
  it('removes only the declared unscoped instance; leaves other stacks and the control plane alone', async () => {
    runtime.inspect.mockResolvedValue([cache, { name: 'omnitron-pg' }, { name: 'other-prod-redis' }]);
    await infraDownCommand();
    expect(runtime.stop.mock.calls).toEqual([[cache.containerId, 10]]);
    expect(runtime.remove.mock.calls).toEqual([[cache.containerId, { graceful: true }]]);
  });
  it('rejects a reused container name or a missing declaration before any removal', async () => {
    runtime.inspect.mockResolvedValue([{ ...cache, labels: { ...cache.labels, 'omnitron.stack': 'other' } }]);
    await expect(infraDownCommand()).rejects.toThrow('another allocation');
    runtime.config.mockResolvedValue({});
    await expect(infraResetCommand({ yes: true })).rejects.toThrow('No infrastructure');
    expect(runtime.stop).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled();
  });
  it('requires the stack lifecycle for projects with named stacks, and refuses unsupported volume removal before effects', async () => {
    runtime.config.mockResolvedValue({ ...spec, stacks: { dev: { type: 'local' } } });
    await expect(infraUpCommand()).rejects.toThrow('declares stacks');
    await expect(infraDownCommand({ volumes: true })).rejects.toThrow('Volume removal');
    expect(runtime.inspect).not.toHaveBeenCalled();
  });
});
