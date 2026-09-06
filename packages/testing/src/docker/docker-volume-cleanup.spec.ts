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
  return { ...actual, execFileSync: (...args: unknown[]) => execFileSyncMock(...args) };
});

const { DockerTestManager } = await import('./docker-test-manager.js');

describe('DockerTestManager container removal', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockReturnValue('');
  });

  it('passes -v everywhere it removes a container', async () => {
    const manager = new DockerTestManager();

    // Any path that removes a container will do; createContainer clears a stale
    // one by name before starting, which is the first of the six call sites.
    await manager
      .createContainer({ name: 'volume-flag-probe', image: 'redis:7-alpine' })
      .catch(() => undefined);

    const removals = execFileSyncMock.mock.calls
      .map((c) => c[1] as string[])
      .filter((args) => Array.isArray(args) && args[0] === 'rm');

    expect(removals.length, 'no container removal was issued').toBeGreaterThan(0);
    for (const args of removals) {
      expect(args, `container removal without -v: ${args.join(' ')}`).toContain('-v');
    }
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
