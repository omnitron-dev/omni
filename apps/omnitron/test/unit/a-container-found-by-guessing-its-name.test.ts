/**
 * `infra psql` said the database was missing while it was serving.
 *
 * Two commands looked for their container by guessing its name —
 * `omnitron-postgres`, then `omnitron-pg`, then `omnitron-redis`. A managed
 * container's name carries the project-and-environment prefix, so those names
 * are right only on a host whose stack happens to be the default one.
 *
 * Measured on the `daos/test` node: `daos-test-postgres` and `daos-test-redis`
 * both up and healthy, and the command answered
 *
 *     No PostgreSQL container found. Run: omnitron infra up
 *
 * — which names the wrong cause and recommends re-provisioning a database that
 * is up. The identity was there the whole time in the `omnitron.service`
 * label, which is what the resolver writes precisely so the prefix does not
 * have to be guessed.
 *
 * The second defect in the same function: the lookup WAS the exec. Quitting
 * psql after a failed query exits non-zero, `execFileSync` throws, and the
 * catch reported an absent container — one signal answering two different
 * questions, the same shape as `systemctl is-active`, which returns `inactive`
 * both for a stopped unit and for a unit that does not exist.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const logged: Array<{ level: string; text: string }> = [];
vi.mock('@xec-sh/kit', () => ({
  log: {
    error: (t: string) => logged.push({ level: 'error', text: t }),
    info: (t: string) => logged.push({ level: 'info', text: t }),
    success: (t: string) => logged.push({ level: 'success', text: t }),
    warn: (t: string) => logged.push({ level: 'warn', text: t }),
  },
  table: () => {},
  prism: new Proxy({}, { get: () => (s: string) => s }),
}));

const listManagedContainers = vi.fn();
vi.mock('../../src/infrastructure/container-runtime.js', () => ({
  listManagedContainers: () => listManagedContainers(),
  getContainerLogs: vi.fn(),
  isDockerAvailable: vi.fn(async () => true),
  stopContainer: vi.fn(),
  removeContainer: vi.fn(),
}));

const execFileSync = vi.fn();
vi.mock('node:child_process', () => ({ execFileSync: (...a: unknown[]) => execFileSync(...a) }));

const { infraPsqlCommand, infraRedisCliCommand } = await import('../../src/commands/infra.js');

/** What the daos/test node actually reports. */
const onTheTestNode = [
  { name: 'daos-test-postgres', service: 'postgres', status: 'running', image: 'imresamu/postgis:17-3.5-alpine' },
  { name: 'daos-test-pg', service: 'omnitron-pg', status: 'running', image: 'postgres:17-alpine' },
  { name: 'daos-test-redis', service: 'redis', status: 'running', image: 'redis:7-alpine' },
];

const said = () => logged.map((l) => l.text).join('\n');
const dockerArgs = () => (execFileSync.mock.calls[0]?.[1] ?? []) as string[];

beforeEach(() => {
  logged.length = 0;
  execFileSync.mockReset();
  listManagedContainers.mockReset();
});

describe('a container is found by what it IS, not what it is called', () => {
  it('reaches a prefixed postgres', async () => {
    listManagedContainers.mockResolvedValue(onTheTestNode);

    await infraPsqlCommand();

    expect(dockerArgs()).toContain('daos-test-postgres');
    expect(said()).not.toMatch(/No PostgreSQL container/);
  });

  it('reaches a prefixed redis', async () => {
    listManagedContainers.mockResolvedValue(onTheTestNode);

    await infraRedisCliCommand();

    expect(dockerArgs()).toContain('daos-test-redis');
  });

  it('prefers the stack database over the daemon’s own', async () => {
    listManagedContainers.mockResolvedValue(onTheTestNode);

    await infraPsqlCommand('paysys');

    // Both are postgres and both are running. `psql` without qualification
    // means the application database; the daemon's internal store is the
    // fallback, and it takes a different superuser.
    expect(dockerArgs()).toContain('daos-test-postgres');
    expect(dockerArgs()).toEqual(expect.arrayContaining(['-U', 'postgres', '-d', 'paysys']));
  });

  it('falls back to the daemon’s own database, with ITS user', async () => {
    listManagedContainers.mockResolvedValue([onTheTestNode[1]]);

    await infraPsqlCommand();

    expect(dockerArgs()).toContain('daos-test-pg');
    expect(dockerArgs()).toEqual(expect.arrayContaining(['-U', 'omnitron']));
  });
});

describe('the two ways of not getting a shell stay apart', () => {
  it('a stopped container is reported as stopped, not as absent', async () => {
    listManagedContainers.mockResolvedValue([{ ...onTheTestNode[0], status: 'stopped' }]);

    await infraPsqlCommand();

    // "Run: omnitron infra up" is right for a host with no container and
    // wrong for one whose container is merely down — and a reader who
    // re-provisions on that advice does more than they were asked.
    expect(said()).toMatch(/daos-test-postgres \(stopped\)/);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('psql exiting non-zero is the user’s session, not a missing container', async () => {
    listManagedContainers.mockResolvedValue(onTheTestNode);
    execFileSync.mockImplementation(() => {
      const err = new Error('Command failed') as Error & { status: number };
      err.status = 3; // psql's own exit after a failed statement
      throw err;
    });

    await infraPsqlCommand();

    expect(logged.filter((l) => l.level === 'error')).toEqual([]);
  });

  it('but a docker failure is still reported', async () => {
    listManagedContainers.mockResolvedValue(onTheTestNode);
    execFileSync.mockImplementation(() => {
      throw new Error('Cannot connect to the Docker daemon');
    });

    await infraPsqlCommand();

    expect(said()).toMatch(/Cannot connect to the Docker daemon/);
  });

  it('says nothing is there when nothing is', async () => {
    listManagedContainers.mockResolvedValue([]);

    await infraPsqlCommand();

    expect(said()).toMatch(/No PostgreSQL container on this host/);
  });
});
