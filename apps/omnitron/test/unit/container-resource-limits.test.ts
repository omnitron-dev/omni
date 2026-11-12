import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ execute: vi.fn(), dispose: vi.fn(), images: vi.fn(), inspect: vi.fn(), remove: vi.fn() }));
vi.mock('@xec-sh/core', () => ({
  DockerAdapter: class {
    listImages = native.images;
    async listContainers() { return ['resource-fixture']; }
    inspectContainer = native.inspect;
    removeContainer = native.remove;
  },
  ExecutionEngine: class { execute = native.execute; dispose = native.dispose; },
}));
import { containerResources, containerResourcesMatch, containerSpecHash, createContainer, getContainerState } from '../../src/infrastructure/container-runtime.js';
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { resolveServiceRequirement } from '../../src/infrastructure/service-resolver.js';
import type { ContainerState, ResolvedContainer } from '../../src/infrastructure/types.js';
const id = 'a'.repeat(64);
const config = (over: Partial<ResolvedContainer> = {}): ResolvedContainer => ({
  name: 'resource-fixture', image: 'fixture:1', ports: [], volumes: [], labels: {}, restart: 'no', environment: {}, ...over,
});
const host = (over: Record<string, number> = {}) => ({ Memory: 128 * 1024 ** 2, MemoryReservation: 64 * 1024 ** 2,
  NanoCpus: 500_000_000, ShmSize: 32 * 1024 ** 2, CpuQuota: 0, CpuPeriod: 0, ...over });
function inspection(HostConfig = host()) {
  const args: string[] = native.execute.mock.calls.at(-1)?.[0].args ?? [];
  const label = args.find(arg => arg.startsWith('omnitron.creation='));
  return { Name: '/resource-fixture', Id: id, Config: { Image: 'fixture:1', Labels: { 'omnitron.creation': label?.split('=')[1] } },
    State: { Status: 'running' }, HostConfig, NetworkSettings: { Networks: { bridge: {} } } };
}
const limits = { memory: '128m', memoryReservation: '64MiB', cpus: 0.5, shmSize: '32mb' };
beforeEach(() => {
  vi.clearAllMocks(); native.images.mockResolvedValue(['fixture:1']); native.execute.mockResolvedValue({ stdout: id + '\n' });
  native.inspect.mockImplementation(async () => inspection());
});

describe('the declared resource limits reach Docker and its observation', () => {
  it('carries custom service resources through the ordinary resolver and Xec argv allocator', async () => {
    const resolved = resolveServiceRequirement('resource-fixture', { type: 'daemon', env: {}, ports: {}, docker: { image: 'fixture:1', resources: limits } });
    expect(resolved?.resources).toEqual(limits);
    expect(await createContainer(config({ resources: resolved!.resources! }))).toBe(id.slice(0, 12));
    const call = native.execute.mock.calls[0]![0];
    expect(call.args).toContain('omnitron.spec-hash-schema=2');
    expect(call).toMatchObject({ command: 'docker', shell: false, adapter: 'local', timeout: 60_000 });
    const position = call.args.indexOf('--memory');
    expect(call.args.slice(position, position + 8)).toEqual(['--memory', '134217728', '--memory-reservation', '67108864', '--cpus', '0.500000000', '--shm-size', '33554432']);
    expect(call.args.indexOf('fixture:1')).toBeGreaterThan(position + 7);
    expect(await getContainerState('resource-fixture', { orThrow: true })).toMatchObject({ resources: {
      memoryBytes: 134217728, memoryReservationBytes: 67108864, nanoCpus: 500_000_000, shmBytes: 33554432, cpuQuota: 0, cpuPeriod: 0,
    } });
  });
  it('uses binary units, fractional memory and exact decimal CPU spelling', async () => {
    const declared = config({ resources: { memory: '2gb', memoryReservation: '1.5 GiB', cpus: 1.001 } });
    native.inspect.mockImplementation(async () => inspection(host({ Memory: 2147483648, MemoryReservation: 1610612736, NanoCpus: 1001000000 })));
    await createContainer(declared);
    expect(containerResources(declared)).toEqual({ memoryBytes: 2147483648, memoryReservationBytes: 1610612736, nanoCpus: 1001000000 });
    expect(native.execute.mock.calls[0]![0].args).toContain('1.001000000');
  });
  it('preserves the top-level shm override and emits one effective argument', async () => {
    native.inspect.mockImplementation(async () => inspection(host({ ShmSize: 256 * 1024 ** 2 })));
    await createContainer(config({ resources: limits, shmSize: '256m' }));
    const args: string[] = native.execute.mock.calls[0]![0].args;
    expect(args.filter(a => a === '--shm-size')).toHaveLength(1);
    expect(args[args.indexOf('--shm-size') + 1]).toBe('268435456');
  });
  it('does not invent limits or inspect resource defaults when declarations are absent', async () => {
    await createContainer(config());
    expect(native.execute.mock.calls[0]![0].args.join(' ')).not.toMatch(/--memory|--cpus|--shm-size/);
    expect(native.inspect).not.toHaveBeenCalled();
  });
  it('keeps explicit unlimited values and daemon-configurable zero-shm defaults distinct from a cap', async () => {
    native.inspect.mockImplementation(async () => inspection(host({ Memory: 0, MemoryReservation: 0, NanoCpus: 0, ShmSize: 96 * 1024 ** 2 })));
    await createContainer(config({ resources: { memory: '0', memoryReservation: '0b', cpus: 0, shmSize: '0' } }));
    const args: string[] = native.execute.mock.calls[0]![0].args;
    expect(args.slice(args.indexOf('--memory'), args.indexOf('--memory') + 8)).toEqual(['--memory', '0', '--memory-reservation', '0', '--cpus', '0.000000000', '--shm-size', '0']);
  });
  it.each(['Memory', 'MemoryReservation', 'NanoCpus', 'ShmSize'])('refuses a silent dropped %s limit and removes only this creation', async field => {
    native.inspect.mockImplementation(async () => inspection(host({ [field]: 0 })));
    await expect(createContainer(config({ resources: limits }))).rejects.toThrow('does not enforce');
    expect(native.remove).toHaveBeenCalledWith(id, true, {});
    expect(native.execute).toHaveBeenCalledOnce();
  });
  it('does not remove another allocation while verifying a failed create', async () => {
    native.inspect.mockResolvedValue({ ...inspection(), Config: { Labels: { 'omnitron.creation': 'someone-else' } } });
    await expect(createContainer(config({ resources: limits }))).rejects.toThrow('belongs to another creation');
    expect(native.remove).not.toHaveBeenCalled();
  });
  it('treats missing HostConfig as unverified, never unlimited', async () => {
    native.inspect.mockImplementation(async () => ({ ...inspection(), HostConfig: undefined }));
    await expect(createContainer(config({ resources: limits }))).rejects.toThrow('does not enforce');
  });
});

describe('invalid declarations fail before any Docker side effect', () => {
  it.each([
    { memory: '-1m' }, { memory: 'NaN' }, { memory: '128m\n--privileged' }, { memory: '1m' },
    { memory: 128 as unknown as string }, { memory: '999999999999999999p' },
    { memoryReservation: '5m' }, { memory: '32m', memoryReservation: '64m' },
    { cpus: NaN }, { cpus: Infinity }, { cpus: -1 }, { cpus: 0.0000000001 },
    { shmSize: '-1' }, { shmSize: '' },
  ])('rejects %j without creating a network, volume or pulling an image', async resources => {
    await expect(createContainer(config({ network: 'must-not-create', volumes: [{ source: 'must-not-create', target: '/data' }], resources }))).rejects.toThrow();
    expect(native.execute).not.toHaveBeenCalled(); expect(native.images).not.toHaveBeenCalled(); expect(native.inspect).not.toHaveBeenCalled();
  });
  it('accepts reservation alone or equal to the hard limit', () => {
    expect(containerResources(config({ resources: { memoryReservation: '64m' } }))).toEqual({ memoryReservationBytes: 67108864 });
    expect(containerResources(config({ resources: { memory: '64m', memoryReservation: '64m' } }))).toEqual({ memoryBytes: 67108864, memoryReservationBytes: 67108864 });
  });
});

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => quiet() }) as never;
const action = (desired: ResolvedContainer, actual: ContainerState) => {
  const service = new InfrastructureService(quiet(), {}, {}, undefined, undefined, false);
  return (service as unknown as { computeAction(d: ResolvedContainer, a: ContainerState): { type: string; reason?: string } }).computeAction(desired, actual);
};
describe('resource identity and reconciliation', () => {
  it('hashes effective limits, preserves a limitless historical identity and ignores key order', () => {
    expect(containerSpecHash(config())).toBe(containerSpecHash(config({ resources: {} })));
    expect(containerSpecHash(config({ resources: { memory: '128m', cpus: 0.5 } }))).toBe(containerSpecHash(config({ resources: { cpus: 0.5, memory: '134217728' } })));
    expect(containerSpecHash(config({ resources: { shmSize: '32m' }, shmSize: '64m' }))).toBe(containerSpecHash(config({ shmSize: '64m' })));
    for (const resources of [{ memory: '128m' }, { memoryReservation: '64m' }, { cpus: 0.5 }, { shmSize: '32m' }])
      expect(containerSpecHash(config({ resources }))).not.toBe(containerSpecHash(config()));
  });
  it.each(['running', 'exited'] as const)('recreates actual resource drift even with a matching desired label while %s', async status => {
    const desired = config({ resources: limits });
    const observed = (await getContainerState('resource-fixture', { orThrow: true }))!;
    const actual = { ...observed, status, specHash: containerSpecHash(desired) };
    expect(action(desired, actual).type).toBe(status === 'running' ? 'noop' : 'start');
    expect(action(desired, { ...actual, resources: { ...actual.resources!, memoryBytes: 0 } })).toMatchObject({ type: 'recreate', reason: 'resource limits differ from Docker inspection' });
  });
  it('does not call explicit zero CPUs unlimited while a manual CPU quota applies', async () => {
    native.inspect.mockImplementation(async () => inspection(host({ NanoCpus: 0, CpuQuota: 50000, CpuPeriod: 100000 })));
    const actual = (await getContainerState('resource-fixture', { orThrow: true }))!;
    expect(containerResourcesMatch(config({ resources: { cpus: 0 } }), actual)).toBe(false);
  });
});
