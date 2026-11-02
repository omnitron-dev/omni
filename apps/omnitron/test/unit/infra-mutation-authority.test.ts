import { describe, expect, it, vi } from 'vitest';
import { InfrastructureRpcService } from '../../src/services/infrastructure.rpc-service.js';
import { resolveServiceRequirement, withInfrastructureScope } from '../../src/infrastructure/service-resolver.js';
import type { HostIngressService } from '../../src/infrastructure/host-ingress.service.js';
import type { ContainerState } from '../../src/infrastructure/types.js';
import * as docker from '../../src/infrastructure/container-runtime.js';

vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...(await original<typeof docker>()),
  listManagedContainers: vi.fn(),
  startContainer: vi.fn(), stopContainer: vi.fn(), removeContainer: vi.fn(), getContainerLogs: vi.fn(),
}));

const target = { name: 'stack-cache', containerId: 'f'.repeat(64), project: 'example', stack: 'test',
  image: 'redis', status: 'exited' } satisfies ContainerState;
const owner = { project: 'example', stack: 'test', app: 'api' };

describe('infrastructure mutation admission', () => {
  it('admits grouped and legacy ownerless provisioning before configuring any infrastructure', async () => {
    const host = vi.fn();
    const rpc = new InfrastructureRpcService(() => null, host);
    const gate = vi.fn(() => { throw new Error('Leader authority required'); });
    rpc.setStackOperationGate(gate);
    await expect(rpc.provisionStack({ config: {} })).rejects.toThrow('Leader authority required');
    expect(gate).toHaveBeenCalledWith(undefined);
    await expect(rpc.provisionStack({ config: {}, project: 'example' })).rejects.toThrow('together');
    await expect(rpc.provisionStack({ config: {}, project: '../other', stack: 'test' })).rejects.toThrow('canonical');
    await expect(rpc.provisionStack({ config: {}, ...owner })).rejects.toThrow('Leader authority required');
    expect(gate).toHaveBeenLastCalledWith({ project: 'example', stack: 'test' });
    expect(host).not.toHaveBeenCalled();
  });

  it('pins actions and log reads to the inspected Docker ID and uses its actual ownership', async () => {
    vi.mocked(docker.listManagedContainers).mockResolvedValue([target]);
    const rpc = new InfrastructureRpcService(() => null);
    const gate = vi.fn(() => { throw new Error('Stack is stopping'); });
    rpc.setStackOperationGate(gate);
    const request = { name: target.name, project: 'invented', stack: 'owner' };
    await expect(rpc.startContainer(request)).rejects.toThrow('Stack is stopping');
    await expect(rpc.stopContainer(request)).rejects.toThrow('Stack is stopping');
    await expect(rpc.removeContainer(request)).rejects.toThrow('Stack is stopping');
    expect(gate).toHaveBeenCalledWith({ project: target.project, stack: target.stack });
    expect(docker.startContainer).not.toHaveBeenCalled();
    expect(docker.stopContainer).not.toHaveBeenCalled();
    expect(docker.removeContainer).not.toHaveBeenCalled();
    await rpc.getContainerLogs(request);
    expect(docker.getContainerLogs).toHaveBeenCalledWith(target.containerId, 100);

    rpc.setStackOperationGate(() => {});
    await rpc.startContainer(request);
    await rpc.stopContainer({ ...request, timeout: 42 });
    await rpc.removeContainer(request);
    expect(docker.startContainer).toHaveBeenCalledWith(target.containerId);
    expect(docker.stopContainer).toHaveBeenCalledWith(target.containerId, 42);
    expect(docker.removeContainer).toHaveBeenCalledWith(target.containerId);
    vi.mocked(docker.listManagedContainers).mockResolvedValue([{ ...target, containerId: 'truncated' }]);
    await expect(rpc.removeContainer(request)).rejects.toThrow('immutable');
    vi.mocked(docker.listManagedContainers).mockRejectedValue(new Error('Docker offline'));
    await expect(rpc.startContainer(request)).rejects.toThrow('Docker offline');
  });

  it('retains read-only ingress diagnosis and refuses all unfenced host or application ingress writes', async () => {
    const ingress = { status: vi.fn(), check: vi.fn() };
    const rpc = new InfrastructureRpcService(() => null, undefined, undefined, undefined, ingress as unknown as HostIngressService);
    rpc.setStackOperationGate(() => { throw new Error('Leader authority required'); });
    const apply = { owner, routes: [], expectedGeneration: null, reservedPorts: [] };
    await rpc.getHostIngress();
    await rpc.checkHostIngress(apply);
    expect(ingress.status).toHaveBeenCalledOnce();
    expect(ingress.check).toHaveBeenCalledWith(apply);
    for (const action of [
      rpc.configureHostIngress({} as never), rpc.validateHostIngress(apply),
      rpc.restoreHostIngressOwner({ owner } as never), rpc.applyHostIngress(apply), rpc.removeHostIngress(apply),
      rpc.recoverHostIngress(), rpc.rollbackHostIngressTakeover({ expectedGeneration: 'old' }),
    ]) await expect(action).rejects.toThrow('Leader authority required');
  });

  it('owns protected container labels even when an override supplies Docker metadata', () => {
    const spec = { docker: { image: 'redis' } };
    withInfrastructureScope('example', 'test', () => {
      const resolve = (labels: Record<string, string>) => resolveServiceRequirement('cache', spec, { docker: { labels } });
      expect(resolve({ 'deployment.note': 'reviewed' })?.labels).toMatchObject({
        'deployment.note': 'reviewed', 'omnitron.project': 'example', 'omnitron.stack': 'test',
      });
      expect(() => resolve({ 'omnitron.stack': 'prod' })).toThrow('reserved');
      expect(() => resolve({ 'omnitron.internal': 'true' })).toThrow('reserved');
    });
    expect(() => withInfrastructureScope(undefined, undefined, () => resolveServiceRequirement('cache', {
      docker: { labels: { 'omnitron.project': 'invented' } },
    }))).toThrow('reserved');
  });
});

describe('raw application lifecycle', () => {
  it('checks the project admission policy before public raw, bulk, configuration and watcher effects', async () => {
    const { DaemonRpcService } = await import('../../src/daemon/daemon.rpc-service.js');
    const effects = { getApp: vi.fn(), startAll: vi.fn(), restartApp: vi.fn(), stop: vi.fn(), setConfig: vi.fn(), list: vi.fn(() => []) };
    const gate = vi.fn(() => { throw new Error('Recipient authority required'); });
    const rpc = new DaemonRpcService(effects as never, {} as never, {} as never, { apps: [] } as never, effects as never, gate);
    const name = { name: 'example/test/app' };
    for (const invoke of [
      () => rpc.startApp(name), () => rpc.startAll(), () => rpc.restartApp(name), () => rpc.restartAll(),
      () => rpc.stopAll({}), () => rpc.reloadApp(name), () => rpc.scale({ ...name, instances: 1 }),
      () => rpc.reloadConfig(), () => rpc.shutdown({}), () => rpc.enableWatch({}),
    ]) await expect(invoke()).rejects.toThrow('Recipient authority required');
    await expect(rpc.stopApp(name)).resolves.toEqual({ success: false, error: 'Recipient authority required' });
    expect(gate).toHaveBeenCalledTimes(11);
    expect(Object.values(effects).every(effect => effect.mock.calls.length === 0)).toBe(true);
    await expect(rpc.list()).resolves.toEqual([]);
  });
});

describe('offline admission', () => {
  it('refuses disabled, removed or malformed policy on an enrolled node without creating new state', async () => {
    const { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync, unlinkSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { default: Database } = await import('better-sqlite3');
    const { CLUSTER_ENROLLMENT_KEY } = await import('../../src/cluster/enrollment.js');
    const { assertStandaloneInfrastructure } = await import('../../src/cluster/standalone-infrastructure.js');
    const dir = mkdtempSync(join(tmpdir(), 'standalone-infra-'));
    const config = join(dir, 'config.json'), file = join(dir, 'data/daemon-state.db');
    try {
      assertStandaloneInfrastructure(dir);
      expect(existsSync(file)).toBe(false);
      writeFileSync(config, JSON.stringify({ cluster: { enabled: true } }));
      expect(() => assertStandaloneInfrastructure(dir)).toThrow('cluster member');
      writeFileSync(config, '{');
      expect(() => assertStandaloneInfrastructure(dir)).toThrow('Cannot read daemon configuration');
      mkdirSync(join(dir, 'data'));
      const db = new Database(file);
      db.exec('CREATE TABLE state_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      db.prepare('INSERT INTO state_kv VALUES (?,?)').run(CLUSTER_ENROLLMENT_KEY, 'null');
      db.close();
      writeFileSync(config, JSON.stringify({ cluster: { enabled: false } }));
      expect(() => assertStandaloneInfrastructure(dir)).toThrow('cluster member');
      unlinkSync(config);
      expect(() => assertStandaloneInfrastructure(dir)).toThrow('cluster member');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

it('explains direct control restrictions in inventory and keeps platform-owned container logs readable', async () => {
  const internal = { ...target, name: 'omnitron-pg', labels: { 'omnitron.internal': 'true' } };
  vi.mocked(docker.listManagedContainers).mockResolvedValue([internal, target, { ...target, name: 'another-service' }]);
  const rpc = new InfrastructureRpcService(() => null);
  const gate = vi.fn(() => { throw new Error('Allocation has a pending stop'); });
  rpc.setStackOperationGate(gate);
  const inventory = await rpc.listContainers();
  expect(inventory.map(item => item.lifecycleRestriction)).toEqual([
    'The control plane owns this container. Use its maintenance workflow.', 'Allocation has a pending stop', 'Allocation has a pending stop',
  ]);
  expect(gate).toHaveBeenCalledOnce();
  const remove = vi.mocked(docker.removeContainer).mockClear();
  await expect(rpc.removeContainer({ name: internal.name })).rejects.toThrow('control plane owns');
  expect(remove).not.toHaveBeenCalled();
  await rpc.getContainerLogs({ name: internal.name });
  expect(docker.getContainerLogs).toHaveBeenCalledWith(internal.containerId, 100);
});
