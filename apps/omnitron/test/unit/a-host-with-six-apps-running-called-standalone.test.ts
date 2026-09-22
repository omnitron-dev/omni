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
 * — against a stand-in Docker: the adapter it lists with, and the
 * `docker inspect` it describes with.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let listContainers: () => Promise<string[]> = async () => [];
let inspect: (names: string[]) => { error?: Error; stdout: string } = () => ({ stdout: '[]' });

vi.mock('@xec-sh/core', () => ({
  DockerAdapter: class {
    listContainers() {
      return listContainers();
    }
  },
}));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    const r = inspect(args.slice(1));
    if (r.error) cb(Object.assign(r.error, { stdout: r.stdout }));
    else cb(null, { stdout: r.stdout, stderr: '' });
  },
}));

import { DockerHealthIndicator } from '../../src/monitoring/docker-health.indicator.js';
import { listManagedContainers } from '../../src/infrastructure/container-runtime.js';

const APPS = ['postgres', 'redis', 'minio', 'gateway', 'tor', 'bitcoin'];

/** What `docker inspect` says about a managed container of daos/test. */
const described = (service: string, state: { Status: string; Health?: { Status: string } }) => ({
  Name: `/daos-test-${service}`,
  Id: `${service}000000000000`,
  Config: {
    Image: `${service}:latest`,
    Labels: { 'omnitron.managed': 'true', 'omnitron.service': service, 'omnitron.project': 'daos', 'omnitron.stack': 'test' },
  },
  State: { ...state, StartedAt: '2026-09-22T23:37:10Z' },
  NetworkSettings: { Ports: {} },
});

const host = (states: Record<string, { Status: string; Health?: { Status: string } }>) => {
  listContainers = async () => Object.keys(states).map((s) => `daos-test-${s}`);
  inspect = () => ({ stdout: JSON.stringify(Object.entries(states).map(([s, st]) => described(s, st))) });
};

/** No reconciler in this daemon: a node since its restart, a master in project mode. */
const indicator = () => new DockerHealthIndicator(() => null);

beforeEach(() => {
  listContainers = async () => [];
  inspect = () => ({ stdout: '[]' });
});

describe('a host with no reconciler in its daemon', () => {
  it('reports the containers Docker has running, not «not provisioned»', async () => {
    host(Object.fromEntries(APPS.map((s) => [s, { Status: 'running', Health: { Status: 'healthy' } }])));

    const result = await indicator().check();

    expect(result.status).toBe('healthy');
    expect(result.message).toBe('All 6 managed containers running (read from Docker: no reconciler in this daemon since its start)');
    expect(result.details).toMatchObject({ source: 'docker', total: 6, running: 6 });
  });

  it('says so, unhealthy, when Docker does not answer', async () => {
    listContainers = async () => {
      throw new Error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');
    };

    const result = await indicator().check();

    expect(result.status).toBe('unhealthy');
    expect(result.message).toMatch(/^Docker did not answer: Cannot connect to the Docker daemon/);
  });

  it('says so when Docker names containers and then describes none of them', async () => {
    listContainers = async () => ['daos-test-postgres', 'daos-test-redis'];
    inspect = () => ({ error: new Error('Error response from daemon: context deadline exceeded'), stdout: '' });

    const result = await indicator().check();

    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('Docker did not answer: docker listed 2 container(s) and then described none of them');
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
    expect(result.message).toMatch(/^1 managed container\(s\) not running: daos-test-old-gateway — no reconciler/);
  });
});

describe('a host with a reconciler in its daemon', () => {
  it('judges by the reconciler\'s own set, as before: a service of it down is a failure', async () => {
    const infra: any = {
      getState: () => ({
        services: {
          postgres: { name: 'daos-test-postgres', status: 'running', health: 'healthy' },
          redis: { name: 'daos-test-redis', status: 'exited' },
        },
      }),
    };

    const result = await new DockerHealthIndicator(() => infra).check();

    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('1 container(s) not running: daos-test-redis');
  });
});

describe('the listing the console reads', () => {
  it('still answers an empty list when Docker cannot be asked', async () => {
    listContainers = async () => {
      throw new Error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock.');
    };

    await expect(listManagedContainers()).resolves.toEqual([]);
    await expect(listManagedContainers({ orThrow: true })).rejects.toThrow(/Cannot connect to the Docker daemon/);
  });
});
