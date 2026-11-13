import { describe, expect, it, vi } from 'vitest';
import { existingContainerMismatch, reconcileLegacyContainer, reviewExistingContainers } from '../../src/infrastructure/existing-containers.js';
import type { ResolvedContainer } from '../../src/infrastructure/types.js';
import { containerSpecHash } from '../../src/infrastructure/container-runtime.js';

function fixture() {
  const desired: ResolvedContainer = {
    name: 'sample-dev-postgres', image: 'postgres:17-alpine', environment: { POSTGRES_PASSWORD: 'private-password' },
    ports: [{ host: 5544, container: 5432, bindHost: '127.0.0.1' }],
    volumes: [{ source: 'sample-dev-postgres-data', target: '/var/lib/postgresql/data' }],
    command: ['postgres', '-c', 'max_connections=40'], shmSize: '256m', restart: 'unless-stopped',
    healthCheck: { test: ['CMD-SHELL', 'psql -tAc "SELECT 1"'], interval: '3s', timeout: '5s', retries: 30, startPeriod: '30s' },
    network: 'sample-dev_default', critical: true,
    labels: { 'omnitron.managed': 'true', 'omnitron.project': 'sample', 'omnitron.stack': 'dev', 'omnitron.service': 'postgres' },
  };
  const image = { Id: 'sha256:' + 'b'.repeat(64), Config: { Env: ['PATH=/bin'], Cmd: ['postgres'], Entrypoint: ['docker-entrypoint.sh'] } };
  const native = {
    Id: 'a'.repeat(64), Name: '/' + desired.name, Image: image.Id,
    State: { Running: true, Status: 'running', StartedAt: '2026-11-10T00:00:00Z', Health: { Status: 'healthy' } },
    Config: { Image: desired.image, Env: ['PATH=/bin', 'POSTGRES_PASSWORD=private-password'], Cmd: desired.command,
      Entrypoint: image.Config.Entrypoint, Labels: { ...desired.labels, 'omnitron.spec-hash': 'old-version-hash' },
      Healthcheck: { Test: desired.healthCheck!.test, Interval: 3e9, Timeout: 5e9, Retries: 30, StartPeriod: 30e9 } },
    HostConfig: { PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5544' }] },
      RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 }, NetworkMode: desired.network,
      ExtraHosts: [], ShmSize: 268435456, Memory: 0, MemorySwap: 0, MemoryReservation: 0, NanoCpus: 0, CpuQuota: 0, CpuPeriod: 0 },
    NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5544' }] },
      Networks: { [desired.network!]: { NetworkID: 'c'.repeat(64), IPAddress: '172.20.0.2' } } },
    Mounts: [{ Type: 'volume', Name: 'sample-dev-postgres-data', Source: '/volumes/sample-dev-postgres-data', Destination: '/var/lib/postgresql/data', RW: true }],
  };
  const probes = { inspect: vi.fn(async () => [native]), image: vi.fn(async () => image), inventory: vi.fn(async () => [{ name: desired.name, id: native.Id }]) };
  return { desired, native, image, probes };
}

describe('preservation from actual Docker resources', () => {
  it('uses the same command and entrypoint semantics as docker run', () => {
    const { desired, native, image } = fixture();
    desired.command = [];
    native.Config.Cmd = image.Config.Cmd;
    expect(existingContainerMismatch(desired, native, image)).toBeNull();
    desired.entrypoint = ['/runner'];
    native.Config.Entrypoint = ['/runner'];
    expect(existingContainerMismatch(desired, native, image)).toBe('command or entrypoint differs');
    Object.assign(native.Config, { Cmd: null });
    expect(existingContainerMismatch(desired, native, image)).toBeNull();
    desired.entrypoint = ['/runner', '--verbose'];
    desired.command = ['serve'];
    native.Config.Cmd = ['--verbose', 'serve'];
    expect(existingContainerMismatch(desired, native, image)).toBeNull();
  });

  it('applies the same loopback default during review as during container creation', () => {
    const { desired, native, image } = fixture();
    delete desired.ports[0]!.bindHost;
    expect(existingContainerMismatch(desired, native, image)).toBeNull();
    native.HostConfig.PortBindings['5432/tcp'][0]!.HostIp = '0.0.0.0';
    native.NetworkSettings.Ports['5432/tcp'][0]!.HostIp = '0.0.0.0';
    expect(existingContainerMismatch(desired, native, image)).toBe('published ports differ');
  });

  function imageVolume() {
    const f = fixture();
    Object.assign(f.image.Config, { Volumes: { '/wal': {}, '/var/lib/postgresql/data': {} } });
    Object.assign(f.native.HostConfig, { Binds: ['sample-dev-postgres-data:/var/lib/postgresql/data'] });
    const volume = { Destination: '/wal', Type: 'volume', Driver: 'local', Name: '7'.repeat(64), RW: true, Mode: '', Source: '/volumes/wal' };
    f.native.Mounts.push(volume);
    return { ...f, volume };
  }

  it('preserves the exact anonymous image volume across a stack restart review', async () => {
    const f = imageVolume();
    const first = await reviewExistingContainers([f.desired], f.probes);
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    f.volume.Name = '8'.repeat(64);
    const second = await reviewExistingContainers([f.desired], f.probes);
    expect(second.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(second.digest).not.toBe(first.digest);
    f.native.HostConfig.Memory = 512 * 1024 * 1024;
    expect(existingContainerMismatch(f.desired, f.native, f.image)).toBe('resource limits differ');
  });

  it('repairs only missing memory limits on the same container and the same image volumes', async () => {
    const { desired, native, probes, volume } = imageVolume();
    desired.resources = { memory: '64m', memoryReservation: '32m' };
    const changed = { Memory: 67108864, MemoryReservation: 33554432, MemorySwap: 134217728 };
    const update = vi.fn(async () => { Object.assign(native.HostConfig, changed); });
    await reconcileLegacyContainer(desired, native.Id, probes, update);
    expect(update).toHaveBeenCalledWith(['--memory', '67108864', '--memory-swap', '134217728', '--memory-reservation', '33554432', native.Id]);
    await reconcileLegacyContainer(desired, native.Id, probes, update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(volume.Name).toBe('7'.repeat(64));
    native.HostConfig.Memory = 0; native.HostConfig.MemorySwap = 0;
    native.Config.Healthcheck.Test = ['CMD-SHELL', 'false'];
    await expect(reconcileLegacyContainer(desired, native.Id, probes, update)).rejects.toThrow('separately reviewed');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('reports an unverified update when the exact native mount changes during it', async () => {
    const { desired, native, probes, volume } = imageVolume();
    desired.resources = { memory: '64m' };
    const update = vi.fn(async () => {
      native.HostConfig.Memory = 67108864; native.HostConfig.MemorySwap = 134217728; volume.Name = '8'.repeat(64);
    });
    await expect(reconcileLegacyContainer(desired, native.Id, probes, update)).rejects.toThrow('Cannot confirm');
    expect(update).toHaveBeenCalledOnce();
  });

  it.each([
    ['an explicit bind at an image destination', (f: ReturnType<typeof imageVolume>) => Object.assign(f.native.HostConfig, { Binds: ['sample-dev-postgres-data:/var/lib/postgresql/data', f.volume.Name + ':/wal'] })],
    ['an explicit mount', (f: ReturnType<typeof imageVolume>) => Object.assign(f.native.HostConfig, { Mounts: [{ Target: '/wal', Source: f.volume.Name }] })],
    ['a volume inherited from another container', (f: ReturnType<typeof imageVolume>) => Object.assign(f.native.HostConfig, { VolumesFrom: ['another'] })],
    ['a named replacement', (f: ReturnType<typeof imageVolume>) => { f.volume.Name = 'database'; }],
    ['another driver', (f: ReturnType<typeof imageVolume>) => { f.volume.Driver = 'other'; }],
    ['a read-only volume', (f: ReturnType<typeof imageVolume>) => { f.volume.RW = false; }],
    ['a missing image volume', (f: ReturnType<typeof imageVolume>) => f.native.Mounts.pop()],
    ['an undeclared destination', (f: ReturnType<typeof imageVolume>) => { f.volume.Destination = '/elsewhere'; }],
    ['duplicate destinations', (f: ReturnType<typeof imageVolume>) => f.native.Mounts.push(f.volume)],
  ])('rejects %s while preserving image volumes', (_name, change) => {
    const f = imageVolume();
    change(f);
    expect(existingContainerMismatch(f.desired, f.native, f.image)).toBe('volume identity or mount permissions differ');
  });

  it('accepts unchanged native settings despite a historical spec-hash algorithm', async () => {
    const f = fixture();
    expect(existingContainerMismatch(f.desired, f.native, f.image)).toBeNull();
    const before = await reviewExistingContainers([f.desired], f.probes);
    expect(before.digest).toMatch(/^[a-f0-9]{64}$/);
    f.native.Config.Labels['omnitron.spec-hash'] = 'new-version-hash';
    expect((await reviewExistingContainers([f.desired], f.probes)).digest).toBe(before.digest);
    expect(JSON.stringify(before)).not.toContain('private-password');
  });

  it.each([
    ['health check', (f: ReturnType<typeof fixture>) => { f.native.Config.Healthcheck.Test = ['CMD-SHELL', 'true']; }],
    ['native volume', (f: ReturnType<typeof fixture>) => { f.native.Mounts[0]!.Name = 'empty-replacement'; }],
    ['volume permission', (f: ReturnType<typeof fixture>) => { f.native.Mounts[0]!.RW = false; }],
    ['published bind', (f: ReturnType<typeof fixture>) => { f.native.HostConfig.PortBindings['5432/tcp'][0]!.HostIp = '0.0.0.0'; }],
    ['network', (f: ReturnType<typeof fixture>) => { f.native.NetworkSettings.Networks = {}; }],
    ['shared memory', (f: ReturnType<typeof fixture>) => { f.native.HostConfig.ShmSize = 64 * 1024 ** 2; }],
    ['undeclared memory cap', (f: ReturnType<typeof fixture>) => { f.native.HostConfig.Memory = 128 * 1024 ** 2; }],
    ['image tag now resolving to different bytes', (f: ReturnType<typeof fixture>) => { f.image.Id = 'sha256:' + 'e'.repeat(64); }],
    ['environment', (f: ReturnType<typeof fixture>) => { f.native.Config.Env.push('UNDECLARED=private-secret'); }],
    ['ownership', (f: ReturnType<typeof fixture>) => { Object.assign(f.native.Config.Labels, { 'omnitron.project': 'foreign' }); }],
    ['native health', (f: ReturnType<typeof fixture>) => { f.native.State.Health.Status = 'unhealthy'; }],
  ])('refuses %s drift even with the original label', async (_name, change) => {
    const f = fixture(); change(f);
    const report = await reviewExistingContainers([f.desired], f.probes);
    expect(report.digest).toBeNull();
    expect(report.checks).toContainEqual(expect.objectContaining({ state: 'blocked' }));
    expect(JSON.stringify(report)).not.toContain('private-');
  });

  it('detects preset drift before any stop or startup operation', async () => {
    const f = fixture();
    f.desired.healthCheck = { ...f.desired.healthCheck!, test: ['CMD-SHELL', 'new probe'] };
    expect((await reviewExistingContainers([f.desired], f.probes)).digest).toBeNull();
  });

  it('binds a review to the full native identity and restart generation', async () => {
    const f = fixture();
    const before = (await reviewExistingContainers([f.desired], f.probes)).digest;
    f.native.Id = 'd'.repeat(64);
    const replaced = (await reviewExistingContainers([f.desired], f.probes)).digest;
    expect(replaced).not.toBeNull(); expect(replaced).not.toBe(before);
    f.native.State.StartedAt = '2026-11-11T00:00:00Z';
    expect((await reviewExistingContainers([f.desired], f.probes)).digest).not.toBe(replaced);
  });

  it('fails closed on incomplete inspection without exposing native errors', async () => {
    const f = fixture(); f.probes.inspect.mockRejectedValue(Error('password=private-value'));
    const report = await reviewExistingContainers([f.desired], f.probes);
    expect(report.digest).toBeNull(); expect(report.checks[0]?.state).toBe('unknown');
    expect(JSON.stringify(report)).not.toContain('private-value');
  });

  it('refuses removed declarations and additional native resources before recovery', async () => {
    const f = fixture();
    expect((await reviewExistingContainers([], f.probes, { project: 'sample', stack: 'dev' })).digest).toBeNull();
    f.probes.inventory.mockResolvedValue([{ name: f.desired.name, id: f.native.Id }, { name: 'sample-dev-old-db', id: 'f'.repeat(64) }]);
    const report = await reviewExistingContainers([f.desired], f.probes);
    expect(report.digest).toBeNull();
    expect(report.checks[0]?.code).toBe('infrastructure.preservation-footprint');
    expect(f.probes.inspect).not.toHaveBeenCalled();
  });

  it('refuses replacement between ownership inventory and native inspection', async () => {
    const f = fixture(); f.probes.inventory.mockResolvedValue([{ name: f.desired.name, id: 'e'.repeat(64) }]);
    expect((await reviewExistingContainers([f.desired], f.probes)).digest).toBeNull();
  });

  it('requires evidence for configuration bytes consumed by an existing container', async () => {
    const f = fixture(); f.desired.configDigest = 'mounted-configuration';
    const unknown = await reviewExistingContainers([f.desired], f.probes);
    expect(unknown.digest).toBeNull(); expect(unknown.checks[0]?.state).toBe('unknown');
    f.native.Config.Labels['omnitron.spec-hash'] = containerSpecHash(f.desired);
    expect((await reviewExistingContainers([f.desired], f.probes)).digest).toMatch(/^[a-f0-9]{64}$/);
    f.desired.configDigest = 'changed-configuration';
    expect((await reviewExistingContainers([f.desired], f.probes)).digest).toBeNull();
  });
});
