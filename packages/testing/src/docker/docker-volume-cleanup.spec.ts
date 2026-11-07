/**
 * Removing a test container must remove the anonymous volumes it created.
 *
 * Every `docker rm` here was `rm -f <name>` with no `-v`. The database and
 * cache images this manager starts all declare `VOLUME` in their Dockerfiles —
 * postgres `/var/lib/postgresql/data`, mysql `/var/lib/mysql`, redis `/data` —
 * so each container came with an anonymous volume, and `rm` without `-v` leaves
 * it behind with nothing pointing at it. One per container, forever.
 *
 * Measured on this machine before the fix: 4940 dangling volumes out of 5012,
 * 188 GB in `Local Volumes` with 72 in use. A leak that fired sometimes would
 * leave an intermediate ratio; 98.6% is a missing flag. It filled the Docker
 * VM's disk and took the user's Postgres down with it.
 *
 * `-v` removes only the container's own ANONYMOUS volumes. Named volumes are
 * untouched, which is why this is safe to do unconditionally: it removes
 * exactly what the container created.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileSyncMock = vi.fn(() => '');

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
    execFile: (...args: unknown[]) => {
      const callback = args.pop() as (error: unknown, stdout: string, stderr: string) => void;
      queueMicrotask(() => {
        try { callback(null, execFileSyncMock(...args), ''); }
        catch (error) {
          const failure = error as { status?: number; stdout?: string; stderr?: string };
          callback({ code: failure.status ?? 1 }, failure.stdout ?? '', failure.stderr ?? '');
        }
      });
    },
  };
});

const { DockerTestManager } = await import('./docker-test-manager.js');

describe('DockerTestManager container removal', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockReturnValue('');
  });

  it('removes anonymous volumes using the immutable ID returned by Docker', async () => {
    const dockerId = 'a'.repeat(64);
    execFileSyncMock.mockImplementation((_exe, args) => args[0] === 'run' ? dockerId : '');
    const manager = DockerTestManager.getInstance({ dockerPath: 'docker', cleanup: false });
    const container = await manager.createContainer({ name: 'volume-flag-probe', image: 'redis:7-alpine' });
    await container.cleanup();
    const removals = execFileSyncMock.mock.calls.map(call => call[1]).filter(args => args[0] === 'rm');
    expect(removals).toEqual([['rm', '-f', '-v', dockerId]]);
  });

  it('leaves existing containers and networks owned by another caller alone', async () => {
    const collision = Object.assign(new Error('fixture'), { status: 125, stderr: 'The container name "/foreign" is already in use' });
    execFileSyncMock.mockImplementation((_exe, args) => {
      if (args[0] === 'network' && args[1] === 'create') throw Object.assign(new Error('fixture'), { stderr: 'network already exists' });
      if (args[0] === 'run') throw collision;
      return '';
    });
    const manager = DockerTestManager.getInstance({ dockerPath: 'docker', cleanup: false });
    await expect(manager.createContainer({ name: 'foreign', image: 'redis:7-alpine', networks: ['shared'] })).rejects.toThrow('name conflict');
    await manager.cleanupAll();
    expect(execFileSyncMock.mock.calls.map(call => call[1]).filter(args => args.includes('rm') || args.includes('stop'))).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('keeps CMD input literal and reserves owner labels', async () => {
    const id = 'b'.repeat(64);
    let run: string[] = [];
    execFileSyncMock.mockImplementation((_exe, args) => {
      if (args[0] === 'run') { run = args; return id; }
      return '';
    });
    const manager = DockerTestManager.getInstance({ dockerPath: 'docker', cleanup: false });
    const literal = "a' b; $(echo INJECTED)";
    const container = await manager.createContainer({ image: 'fixture', labels: { 'test.id': 'foreign' },
      healthcheck: { test: ['CMD', 'printf', '%s', literal] } });
    expect(container.labels['test.id']).toBe(container.id);
    const command = run[run.indexOf('--health-cmd') + 1];
    const { execFileSync } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    expect(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })).toBe(literal);
    await container.cleanup();
  });

  it('passes command argv without losing empty arguments or evaluating shell syntax', async () => {
    const id = 'c'.repeat(64);
    let run: string[] = [];
    execFileSyncMock.mockImplementation((_exe, args) => {
      if (args[0] === 'run') { run = args; return id; }
      return '';
    });
    const manager = DockerTestManager.getInstance({ dockerPath: 'docker', cleanup: false });
    const command = ['redis-server', '--save', '', '--requirepass', "a' b; $(echo INJECTED)"];
    const container = await manager.createContainer({ image: 'fixture', command });
    expect(run.slice(run.indexOf('fixture') + 1)).toEqual(command);
    await container.cleanup();
  });

  it('never passes -v to a network removal', () => {
    // `docker network rm` has no such flag; the blanket edit must not have
    // reached it.
    const source = readFileSync(
      new URL('./docker-test-manager.ts', import.meta.url),
      'utf-8'
    );
    expect(source).not.toMatch(/\['network', 'rm', '-v'/);
  });
});

import { readFileSync } from 'node:fs';
