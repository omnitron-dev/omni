/**
 * `infra status` and `infra logs` saw only this machine, and did not say so.
 *
 * Measured 2026-09-23 on the master: `omnitron infra status` printed twelve
 * `sample-dev-*` / `omnitron-*` containers with no host and no stack column,
 * and the six containers of the test stack — on 37.27.130.185 — were
 * invisible, with nothing to say they existed. `omnitron infra logs tor`
 * printed `sample-dev-tor`'s log bare: the first container whose NAME
 * contained «tor», on this machine, whatever stack the operator meant.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IStackInfo } from '../../src/shared/dto/project.js';

const said: Array<{ level: string; text: string }> = [];
const tables: Array<Array<Record<string, unknown>>> = [];
vi.mock('@xec-sh/kit', () => ({
  log: {
    info: (t: string) => said.push({ level: 'info', text: t }),
    warn: (t: string) => said.push({ level: 'warn', text: t }),
    error: (t: string) => said.push({ level: 'error', text: t }),
    success: (t: string) => said.push({ level: 'success', text: t }),
    step: (t: string) => said.push({ level: 'step', text: t }),
  },
  table: (opts: { data: Array<Record<string, unknown>> }) => tables.push(opts.data),
  prism: new Proxy({}, { get: () => (s: string) => s }),
}));

let containers: Array<Record<string, unknown>> = [];
const listContainers = vi.fn(async () => containers);
const listManagedContainers = vi.fn(async (_options?: { orThrow?: boolean }) => containers);
const isReachable = vi.fn(async () => true);
const getContainerLogs = vi.fn(async (name: string) => `log of ${name}`);
const inspectStackContainers = vi.fn(() => { throw new Error('Unexpected Docker stack inspection in infrastructure command test'); });
vi.mock('../../src/infrastructure/container-runtime.js', () => ({
  listManagedContainers,
  inspectStackContainers,
  getContainerLogs: (name: string) => getContainerLogs(name),
  isDockerAvailable: vi.fn(async () => true),
  stopContainer: vi.fn(),
  removeContainer: vi.fn(),
}));

const getStack = vi.fn(async ({ project, stack }: { project: string; stack: string }): Promise<Partial<IStackInfo>> =>
  stack === 'test'
    ? {
        name: stack,
        type: 'remote',
        nodes: [{ host: '37.27.130.185', port: 9700, role: 'worker', label: null, daemonRole: 'slave', connected: true, lastSeen: null, syncStatus: null }],
        infrastructure: {
          ready: false,
          services: {
            postgres: { status: 'running', containerName: `${project}-test-postgres`, port: 5432 },
            tor: { status: 'stopped', nativeStatus: 'restarting', containerName: `${project}-test-tor`, port: null, health: 'none' },
          },
        },
      }
    : { name: stack, type: 'local', nodes: [], infrastructure: { ready: false, services: {} } },
);
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({
    isReachable,
    service: async () => ({ getStack, listContainers }),
    disconnect: async () => {},
  }),
}));

const { infraStatusCommand, infraLogsCommand } = await import('../../src/commands/infra.js');

const dev = (service: string, extra: Record<string, unknown> = {}) => ({
  name: `sample-dev-${service}`, service, project: 'sample', stack: 'dev', status: 'running', image: `${service}:x`, health: 'healthy', ...extra,
});

let written: string[] = [];
let restore: () => void = () => {};
const text = () => [...said.map((s) => s.text), ...written].join('\n');

beforeEach(() => {
  said.length = 0;
  tables.length = 0;
  written = [];
  containers = [dev('postgres'), dev('tor'), { name: 'omnitron-pg', service: 'omnitron-pg', status: 'running', image: 'postgres:17-alpine' }];
  getStack.mockClear();
  listContainers.mockReset();
  listManagedContainers.mockClear();
  isReachable.mockClear();
  getContainerLogs.mockClear();
  inspectStackContainers.mockClear();
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  restore = () => spy.mockRestore();
});

afterEach(() => {
  restore();
  process.exitCode = undefined;
  expect(inspectStackContainers).not.toHaveBeenCalled();
});

describe('infra status', () => {
  it('says whose containers these are, and which stack each belongs to', async () => {
    await infraStatusCommand();

    expect(text()).toMatch(/Containers on this machine \(.+\)/);
    expect(tables[0]!.map((r) => [r['name'], r['stack']])).toEqual([
      ['sample-dev-postgres', 'sample/dev'],
      ['sample-dev-tor', 'sample/dev'],
      ['omnitron-pg', '-'],
    ]);
    expect(getStack).not.toHaveBeenCalled();
  });

  it('--stack reaches a remote stack\'s containers on its node', async () => {
    await infraStatusCommand({ stack: 'sample/test' });

    expect(getStack).toHaveBeenCalledWith({ project: 'sample', stack: 'test' });
    expect(text()).toContain('Containers of sample/test on 37.27.130.185 — asked of the node through the daemon');
    expect(tables[0]!.map((r) => r['container'])).toEqual(['sample-test-postgres', 'sample-test-tor']);
    expect(tables[0]?.[1]).toMatchObject({ status: 'restarting', health: 'none' });
  });

  it('--stack on a stack of this machine lists only its containers', async () => {
    containers.push({ name: 'shop-prod-redis', service: 'redis', project: 'shop', stack: 'prod', status: 'running', image: 'redis' });

    await infraStatusCommand({ stack: 'shop/prod' });

    expect(tables[0]!.map((r) => r['name'])).toEqual(['shop-prod-redis']);
    expect(getStack).toHaveBeenCalledWith({ project: 'shop', stack: 'prod' });
  });

  it('reads a remote stack even when local Docker is unavailable', async () => {
    listContainers.mockImplementationOnce(async () => { throw Error('Local Docker unavailable'); });
    await infraStatusCommand({ stack: 'sample/test' });
    expect(tables[0]!.map(row => row['container'])).toContain('sample-test-postgres');
    expect(listContainers).not.toHaveBeenCalled();
    expect(listManagedContainers).not.toHaveBeenCalled();
  });

  it('never substitutes local containers whose labels collide with the selected remote stack', async () => {
    containers.unshift(dev('unrelated', { project: 'sample', stack: 'test' }));
    await infraStatusCommand({ stack: 'sample/test' });
    expect(getStack).toHaveBeenCalledWith({ project: 'sample', stack: 'test' });
    expect(tables[0]!.map(row => row['container'])).toEqual(['sample-test-postgres', 'sample-test-tor']);
    expect(listContainers).not.toHaveBeenCalled();
  });

  it('uses the runtime project and stack of an imported local stack', async () => {
    getStack.mockResolvedValueOnce({ type: 'local', runtimeScope: { project: 'sample-markets', stack: 'local' } });
    containers = [dev('wrong', { project: 'sample', stack: 'markets' }),
      dev('right', { name: 'sample-markets-local-db', project: 'sample-markets', stack: 'local' })];
    await infraStatusCommand({ stack: 'sample/markets' });
    expect(tables[0]!.map(row => row['name'])).toEqual(['sample-markets-local-db']);
  });

  it('distinguishes empty local inventory from an unavailable controller or Docker inventory', async () => {
    containers = [];
    await infraStatusCommand({ stack: 'sample/dev' });
    expect(text()).toContain('No managed containers of sample/dev');
    expect(process.exitCode).not.toBe(1);
    said.length = 0;
    listContainers.mockRejectedValueOnce(Error('Docker is offline'));
    await infraStatusCommand({ stack: 'sample/dev' });
    expect(text()).toMatch(/inventory unavailable.*Docker is offline/i);
    expect(text()).not.toContain('No managed containers');
    expect(process.exitCode).toBe(1);
    said.length = 0;
    getStack.mockRejectedValueOnce(Error('Unknown stack'));
    await infraStatusCommand({ stack: 'sample/missing' });
    expect(text()).toMatch(/inventory unavailable.*Unknown stack/i);
    expect(listContainers).toHaveBeenCalledTimes(2);
  });

  it('preserves distinct node observations, positive empty inventory and missing inventory in a cluster', async () => {
    const placement = (nodeKey: string, infrastructure: IStackInfo['infrastructure'] | null) => ({
      nodeKey, host: nodeKey, port: 9700, label: null, observedAt: null, appsObserved: false, apps: [],
      infrastructureObserved: infrastructure !== null, infrastructure, errors: [],
    });
    const services = { redis: { status: 'running' as const, containerName: 'shared-name', port: 6379 } };
    getStack.mockResolvedValueOnce({ type: 'cluster', nodes: [], infrastructure: { ready: false, services: {} },
      placements: [placement('one:9700', { ready: true, services }), placement('two:9700', { ready: true, services }),
        placement('empty:9700', { ready: true, services: {} }), placement('missing:9700', null)] });
    await infraStatusCommand({ stack: 'sample/cluster' });
    expect(tables[0]?.map(row => [row['node'], row['container']])).toEqual([['one:9700', 'shared-name'], ['two:9700', 'shared-name']]);
    expect(text()).toContain('empty:9700: no managed containers reported');
    expect(text()).toContain('missing:9700: infrastructure inventory unavailable');
    expect(listContainers).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('keeps the native local inventory available without a daemon in global mode', async () => {
    isReachable.mockResolvedValueOnce(false);
    await infraStatusCommand();
    expect(listManagedContainers).toHaveBeenCalledExactlyOnceWith({ orThrow: true });
    expect(getStack).not.toHaveBeenCalled();
    expect(tables[0]!.length).toBe(3);
  });

  it('--stack refuses what is not <project>/<stack>', async () => {
    await infraStatusCommand({ stack: 'sample' });

    expect(text()).toMatch(/--stack takes <project>\/<stack>/);
    expect(process.exitCode).toBe(1);
    expect(listContainers).not.toHaveBeenCalled();
    expect(getStack).not.toHaveBeenCalled();
  });
});

describe('infra logs', () => {
  it('names the container, its stack and this machine before the log', async () => {
    await infraLogsCommand('tor', {});

    expect(written.join('')).toMatch(/─── sample-dev-tor — stack sample\/dev, this machine \(.+\) ───\nlog of sample-dev-tor/);
  });

  it('lists the candidates rather than taking the first of two', async () => {
    containers.push({ name: 'shop-prod-tor', service: 'tor', project: 'shop', stack: 'prod', status: 'running', image: 'alpine' });

    await infraLogsCommand('tor', {});

    expect(getContainerLogs).not.toHaveBeenCalled();
    expect(text()).toContain("'tor' matches 2 containers on this machine");
    expect(text()).toContain('shop-prod-tor  (stack shop/prod)');
    expect(process.exitCode).toBe(1);
  });

  it('--stack for a remote stack says where its logs are, and prints none of this machine\'s', async () => {
    await infraLogsCommand('tor', { stack: 'sample/test', lines: '20' });

    expect(getContainerLogs).not.toHaveBeenCalled();
    expect(text()).toContain('The containers of sample/test run on 37.27.130.185, not on this machine');
    expect(text()).toContain('docker logs --tail 20 sample-test-tor');
    expect(process.exitCode).toBe(1);
  });

  it('fails for a service with no container here', async () => {
    await infraLogsCommand('minio', {});

    expect(process.exitCode).toBe(1);
  });
});

it('prints the same failed setup and reason that Console receives from RPC', async () => {
  containers = [dev('minio', { provisioning: 'failed', error: 'Required bucket policy denied' })];
  await infraStatusCommand();
  expect(tables[0]?.[0]).toMatchObject({ health: 'healthy', setup: 'failed', reason: 'Required bucket policy denied' });
});
