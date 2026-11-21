/**
 * A host with six apps running, called «not provisioned (standalone mode)».
 *
 * The `docker` health indicator read the infrastructure from the
 * reconciler in this process — and where there was none, said
 * «Infrastructure not provisioned (standalone mode)», `healthy`. Measured
 * 2026-09-22 after an upgrade, on both machines: the test node, whose
 * reconciler exists only once the master provisions it again after a
 * restart, and the master, whose stacks own their infrastructure. Each had
 * six apps' worth of containers up. The indicator was consulted for the one
 * thing it did not know, and answered anyway.
 *
 * Without a reconciler, Docker knows what is there. These cases run the
 * indicator's real default path — `listManagedContainers({ orThrow: true })`
 * — against the managed ownership rows from `docker ps` and the
 * `docker inspect` response for the listed container IDs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const dockerPs = vi.hoisted(() => vi.fn());
let inspect: (ids: string[]) => { error?: Error; stdout: string } = () => ({ stdout: '[]' });

vi.mock('@xec-sh/core', () => ({
  ExecutionEngine: class {
    execute = dockerPs;
    dispose() {}
  },
}));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: (cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    if (cmd !== 'docker' || args[0] !== 'inspect') throw new Error('Expected docker inspect');
    const r = inspect(args.slice(1));
    if (r.error) cb(Object.assign(r.error, { stdout: r.stdout }));
    else cb(null, { stdout: r.stdout, stderr: '' });
  },
}));

import { DockerHealthIndicator } from '../../src/monitoring/docker-health.indicator.js';
import { listManagedContainers } from '../../src/infrastructure/container-runtime.js';

const APPS = ['postgres', 'redis', 'minio', 'gateway', 'tor', 'bitcoin'];

/** What `docker inspect` says about a managed container of sample/test. */
const described = (service: string, state: { Status: string; Health?: { Status: string } }, index: number) => ({
  Name: `/sample-test-${service}`,
  Id: (index + 1).toString(16).padStart(64, '0'),
  Config: {
    Image: `${service}:latest`,
    Labels: { 'omnitron.managed': 'true', 'omnitron.service': service, 'omnitron.project': 'sample', 'omnitron.stack': 'test' },
  },
  State: { ...state, StartedAt: '2026-09-22T23:37:10Z' },
  NetworkSettings: { Ports: {} },
});

const host = (states: Record<string, { Status: string; Health?: { Status: string } }>) => {
  const containers = Object.entries(states).map(([service, state], index) => described(service, state, index));
  const rows = containers.map(({ Id, Name, Config: { Labels } }) => JSON.stringify({
    id: Id,
    name: Name.slice(1),
    managed: Labels['omnitron.managed'],
    project: Labels['omnitron.project'],
    stack: Labels['omnitron.stack'],
  }));
  dockerPs.mockResolvedValue({ stdout: rows.join('\n') });
  inspect = (ids) => ({ stdout: JSON.stringify(containers.filter(container => ids.includes(container.Id))) });
};

/** No reconciler in this daemon: a node since its restart, a master in project mode. */
const indicator = () => new DockerHealthIndicator(() => null);

beforeEach(() => {
  dockerPs.mockReset().mockResolvedValue({ stdout: '' });
  inspect = () => ({ stdout: '[]' });
});

describe('a host with no reconciler in its daemon', () => {
  it('reports the containers Docker has running, not «not provisioned»', async () => {
    host(Object.fromEntries(APPS.map((s) => [s, { Status: 'running', Health: { Status: 'healthy' } }])));

    const result = await indicator().check();

    expect(dockerPs).toHaveBeenCalledWith(expect.objectContaining({
      command: 'docker', args: expect.arrayContaining(['ps', '--no-trunc', 'label=omnitron.managed=true']),
    }));
    expect(result.status).toBe('healthy');
    expect(result.message).toBe('All 6 managed containers running (read from Docker: no reconciler in this daemon since its start)');
    expect(result.details).toMatchObject({ source: 'docker', total: 6, running: 6 });
  });

  it('says so, unhealthy, when Docker does not answer', async () => {
    dockerPs.mockRejectedValue(new Error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'));

    const result = await indicator().check();

    expect(result.status).toBe('unhealthy');
    expect(result.message).toMatch(/^Docker did not answer: Cannot connect to the Docker daemon/);
  });

  it('says so when Docker names containers and then describes none of them', async () => {
    host({ postgres: { Status: 'running' }, redis: { Status: 'running' } });
    inspect = () => ({ error: new Error('Error response from daemon: context deadline exceeded'), stdout: '' });

    const result = await indicator().check();

    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('Docker did not answer: Error response from daemon: context deadline exceeded');
  });

  it('calls a host with nothing managed healthy, in those words', async () => {
    const result = await indicator().check();

    expect(result.status).toBe('healthy');
    expect(result.message).toBe('No managed containers on this host');
  });

  it('calls a stopped container degraded — Docker does not know whether it is wanted', async () => {
    host({ postgres: { Status: 'running' }, 'old-gateway': { Status: 'exited' } });

    const result = await indicator().check();

    expect(result.status).toBe('degraded');
    expect(result.message).toMatch(/^1 managed container\(s\) not running: sample-test-old-gateway — no reconciler/);
  });
});

describe('a host with a reconciler in its daemon', () => {
  it('judges by the reconciler\'s own set, as before: a service of it down is a failure', async () => {
    const infra: any = {
      getState: () => ({
        services: {
          postgres: { name: 'sample-test-postgres', status: 'running', health: 'healthy' },
          redis: { name: 'sample-test-redis', status: 'exited' },
        },
      }),
    };

    const result = await new DockerHealthIndicator(() => infra).check();

    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('1 container(s) not running: sample-test-redis');
  });
});

describe('the listing the console reads', () => {
  it('still answers an empty list when Docker cannot be asked', async () => {
    dockerPs.mockRejectedValue(new Error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock.'));

    await expect(listManagedContainers()).resolves.toEqual([]);
    await expect(listManagedContainers({ orThrow: true })).rejects.toThrow(/Cannot connect to the Docker daemon/);
  });
});
