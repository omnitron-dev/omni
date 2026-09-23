/**
 * `infra status` and `infra logs` saw only this machine, and did not say so.
 *
 * Measured 2026-09-23 on the master: `omnitron infra status` printed twelve
 * `daos-dev-*` / `omnitron-*` containers with no host and no stack column,
 * and the six containers of the test stack — on 37.27.130.185 — were
 * invisible, with nothing to say they existed. `omnitron infra logs tor`
 * printed `daos-dev-tor`'s log bare: the first container whose NAME
 * contained «tor», on this machine, whatever stack the operator meant.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
const getContainerLogs = vi.fn(async (name: string) => `log of ${name}`);
vi.mock('../../src/infrastructure/container-runtime.js', () => ({
  listManagedContainers: async () => containers,
  getContainerLogs: (name: string) => getContainerLogs(name),
  isDockerAvailable: vi.fn(async () => true),
  stopContainer: vi.fn(),
  removeContainer: vi.fn(),
}));

const getStack = vi.fn(async ({ project, stack }: { project: string; stack: string }) =>
  stack === 'test'
    ? {
        name: stack,
        type: 'remote',
        nodes: [{ host: '37.27.130.185', port: 9700 }],
        infrastructure: {
          ready: true,
          services: {
            postgres: { status: 'running', containerName: `${project}-test-postgres`, port: 5432 },
            tor: { status: 'running', containerName: `${project}-test-tor`, port: null },
          },
        },
      }
    : { name: stack, type: 'local', nodes: [], infrastructure: { ready: false, services: {} } },
);
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({
    isReachable: async () => true,
    service: async () => ({ getStack }),
    disconnect: async () => {},
  }),
}));

const { infraStatusCommand, infraLogsCommand } = await import('../../src/commands/infra.js');

const dev = (service: string, extra: Record<string, unknown> = {}) => ({
  name: `daos-dev-${service}`, service, project: 'daos', stack: 'dev', status: 'running', image: `${service}:x`, health: 'healthy', ...extra,
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
  getContainerLogs.mockClear();
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  restore = () => spy.mockRestore();
});

afterEach(() => {
  restore();
  process.exitCode = undefined;
});

describe('infra status', () => {
  it('says whose containers these are, and which stack each belongs to', async () => {
    await infraStatusCommand();

    expect(text()).toMatch(/Containers on this machine \(.+\)/);
    expect(tables[0]!.map((r) => [r['name'], r['stack']])).toEqual([
      ['daos-dev-postgres', 'daos/dev'],
      ['daos-dev-tor', 'daos/dev'],
      ['omnitron-pg', '-'],
    ]);
  });

  it('--stack reaches a remote stack\'s containers on its node', async () => {
    await infraStatusCommand({ stack: 'daos/test' });

    expect(getStack).toHaveBeenCalledWith({ project: 'daos', stack: 'test' });
    expect(text()).toContain('Containers of daos/test on 37.27.130.185 — asked of the node through the daemon');
    expect(tables[0]!.map((r) => r['container'])).toEqual(['daos-test-postgres', 'daos-test-tor']);
  });

  it('--stack on a stack of this machine lists only its containers', async () => {
    containers.push({ name: 'shop-prod-redis', service: 'redis', project: 'shop', stack: 'prod', status: 'running', image: 'redis' });

    await infraStatusCommand({ stack: 'shop/prod' });

    expect(tables[0]!.map((r) => r['name'])).toEqual(['shop-prod-redis']);
    expect(getStack).not.toHaveBeenCalled();
  });

  it('--stack refuses what is not <project>/<stack>', async () => {
    await infraStatusCommand({ stack: 'daos' });

    expect(text()).toMatch(/--stack takes <project>\/<stack>/);
    expect(process.exitCode).toBe(1);
  });
});

describe('infra logs', () => {
  it('names the container, its stack and this machine before the log', async () => {
    await infraLogsCommand('tor', {});

    expect(written.join('')).toMatch(/─── daos-dev-tor — stack daos\/dev, this machine \(.+\) ───\nlog of daos-dev-tor/);
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
    await infraLogsCommand('tor', { stack: 'daos/test', lines: '20' });

    expect(getContainerLogs).not.toHaveBeenCalled();
    expect(text()).toContain('The containers of daos/test run on 37.27.130.185, not on this machine');
    expect(text()).toContain('docker logs --tail 20 daos-test-tor');
    expect(process.exitCode).toBe(1);
  });

  it('fails for a service with no container here', async () => {
    await infraLogsCommand('minio', {});

    expect(process.exitCode).toBe(1);
  });
});
