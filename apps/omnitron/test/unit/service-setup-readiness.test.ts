import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ get: vi.fn(), healthy: vi.fn(), remove: vi.fn(), create: vi.fn(), start: vi.fn(), list: vi.fn() }));
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...(await original<Record<string, unknown>>()), getContainerState: runtime.get, waitForHealthy: runtime.healthy,
  removeContainer: runtime.remove, createContainer: runtime.create, startContainer: runtime.start, listManagedContainers: runtime.list,
}));
import { InfrastructureRpcService } from '../../src/services/infrastructure.rpc-service.js';
import { DockerHealthIndicator } from '../../src/monitoring/docker-health.indicator.js';
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { PresetRegistry } from '../../src/infrastructure/presets/registry.js';
import { containerSpecHash } from '../../src/infrastructure/container-runtime.js';
import { retainProvisioningObservation, summariseProvisioning } from '../../src/infrastructure/provisioning-outcome.js';
import type { ContainerState } from '../../src/infrastructure/types.js';

const logger: any = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const instances: InfrastructureService[] = [];
beforeEach(() => { vi.clearAllMocks(); runtime.healthy.mockResolvedValue(true); });
afterEach(() => { for (const service of instances.splice(0)) service.dispose(); vi.useRealTimers(); });
function fixture() {
  const hook = vi.fn().mockResolvedValue(undefined), registry = new PresetRegistry();
  registry.register({ name: 'fixture', type: 'storage', defaultImage: 'fixture:1', defaultPorts: {},
    defaultDocker: {}, defaultSecrets: {}, defaultHealthCheck: { type: 'command', target: 'true' }, postProvision: hook });
  const service: any = new InfrastructureService(logger, { services: { storage: { preset: 'fixture' } } }, undefined, registry, undefined, false);
  instances.push(service);
  const desired = service.getDesiredContainers()[0];
  const actual: ContainerState = { name: desired.name, image: desired.image, status: 'running', health: 'healthy',
    containerId: 'a'.repeat(64), startedAt: '2026-01-01T00:00:00Z', labels: desired.labels, specHash: containerSpecHash(desired) };
  runtime.get.mockImplementation(async () => structuredClone(actual));
  const outcome = () => summariseProvisioning(service.getDesiredServices(), service.getState().services);
  return { service, hook, actual, desired, outcome };
}

describe('declared service setup belongs to infrastructure readiness', () => {
  it('keeps a failed setup distinct from a healthy native container, including handoff', async () => {
    const { service, hook, actual, outcome } = fixture();
    hook.mockRejectedValue(new Error('Required bucket policy was denied'));
    await service.runPresetPostProvisionHooks();
    expect(outcome()).toMatchObject({ ready: false, failed: [{ status: 'running', error: expect.stringContaining('policy was denied') }] });
    const before = service.getState().services[actual.name];
    service.recordContainerObservation(service.getDesiredContainers()[0], actual);
    expect(service.getState().services[actual.name]).toEqual(before);
    const snapshot = await service.prepareHandoff();
    expect(snapshot.nativeState.observations[0].containerId).toBe(actual.containerId!.slice(0, 12));
    expect(snapshot.state.services[actual.name].containerId).toBe(actual.containerId);
    const restored = await InfrastructureService.adoptHandoff(logger, snapshot); instances.push(restored);
    expect(restored.getState().services[actual.name]).toMatchObject({ provisioning: 'failed', error: expect.stringContaining('policy was denied') });
    expect(runtime.remove).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.start).not.toHaveBeenCalled();
  });
  it('backs off failed setup without restarting a healthy container and clears the error only after success', async () => {
    vi.useFakeTimers();
    const { service, hook, actual } = fixture();
    hook.mockRejectedValueOnce(new Error('S3 unavailable')).mockRejectedValueOnce(new Error('S3 still unavailable'));
    await service.runPresetPostProvisionHooks();
    await service.healthSweep();
    expect(hook).toHaveBeenCalledTimes(2);
    await service.healthSweep(); expect(hook).toHaveBeenCalledTimes(2);
    expect(service.getState().ready).toBe(false);
    vi.setSystemTime(Date.now() + 30_001);
    await service.healthSweep();
    expect(hook).toHaveBeenCalledTimes(3);
    expect(service.getState()).toMatchObject({ ready: true, services: { [actual.name]: { provisioning: 'ready', status: 'running' } } });
    expect(service.getState().services[actual.name].error).toBeUndefined();
    expect(runtime.remove).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.start).not.toHaveBeenCalled();
  });
  it('does not call a setup hook after the native health deadline', async () => {
    const { service, hook, outcome } = fixture(); runtime.healthy.mockResolvedValue(false);
    await service.runPresetPostProvisionHooks();
    expect(hook).not.toHaveBeenCalled();
    expect(outcome().failed[0]?.error).toContain('did not become healthy');
  });
  it('refuses an unavailable preset and a container changed during setup', async () => {
    const { service, hook, actual, outcome } = fixture();
    hook.mockImplementationOnce(async () => { actual.startedAt = '2026-01-02T00:00:00Z'; });
    await service.runPresetPostProvisionHooks();
    expect(outcome().failed[0]?.error).toContain('generation changed');
    service.presetRegistry = new PresetRegistry();
    await service.runPresetPostProvisionHooks();
    expect(outcome().failed[0]?.error).toContain('unavailable');
    expect(hook).toHaveBeenCalledOnce();
  });
  it('makes changed setup declarations pending even when the Docker specification is unchanged', async () => {
    const { service, actual } = fixture();
    await service.runPresetPostProvisionHooks();
    const declarations = structuredClone(service.getNormalizedServices());
    declarations.storage._presetConfig = { buckets: ['new-bucket'] };
    service.provisionOwned = vi.fn(async () => service.getState());
    await service.provision(service.resolveDefinition({ services: {} }, declarations));
    expect(service.getState().services[actual.name]).toMatchObject({ provisioning: 'pending', error: expect.stringContaining('setup changed') });
  });
  it('redacts known credentials before an error reaches the shared state and diagnostic logger', async () => {
    const { service, hook, actual } = fixture();
    service.normalizedServices.storage.secrets = { secretKey: 'private-test-value' };
    hook.mockRejectedValue(new Error('mc rejected private-test-value'));
    await service.runPresetPostProvisionHooks();
    expect(service.getState().services[actual.name].error).toContain('[redacted]');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private-test-value');
  });
});

it('never attaches a previous setup receipt to a replacement or restarted native container', () => {
  const previous: ContainerState = { name: 'fixture', image: 'fixture:1', status: 'running', health: 'healthy',
    containerId: 'a'.repeat(64), startedAt: 'first', specHash: 'same', provisioning: 'ready' };
  for (const actual of [{ ...previous, containerId: 'b'.repeat(64) }, { ...previous, startedAt: 'next' }]) {
    expect(retainProvisioningObservation(actual, previous, true)).toMatchObject({ provisioning: 'pending', error: expect.stringContaining('not verified') });
  }
});

it('RPC and health retain a failed setup even while the native probe is healthy', async () => {
  const { service, hook, actual } = fixture();
  hook.mockRejectedValue(new Error('Required policy denied'));
  await service.runPresetPostProvisionHooks();
  runtime.list.mockResolvedValue([actual]);
  const rpc = new InfrastructureRpcService(() => null, undefined, undefined, undefined, undefined,
    () => Object.values(service.getState().services));
  expect(await rpc.listContainers()).toMatchObject([{ health: 'healthy', provisioning: 'failed', error: expect.stringContaining('policy denied') }]);
  const health = new DockerHealthIndicator(() => null, async () => [actual], () => ({
    stacks: [], requiredContainers: [actual.name], unresolvedStacks: [], observedServices: Object.values(service.getState().services),
  }));
  expect(await health.check()).toMatchObject({ status: 'unhealthy', message: expect.stringContaining('policy denied') });
  actual.startedAt = '2026-01-03T00:00:00Z';
  expect(await rpc.listContainers()).toMatchObject([{ provisioning: 'pending', error: expect.stringContaining('not verified') }]);
});
