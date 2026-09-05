/**
 * A host port taken between the availability check and `docker run` must not
 * fail the container start.
 *
 * `findAvailablePort()` binds a socket, reads the port and releases it. Between
 * that release and `docker run -p <port>:...` anything on the machine can take
 * it — another suite in this repo, another session, a container someone
 * restarted. The window is small and the machine is shared, which is the
 * combination that produces a red test blaming the code under test. Observed
 * exactly that way: a Redis cluster master failed with
 * "Bind for 0.0.0.0:15432 failed: port is already allocated", where 15432
 * belonged to a Postgres container started by a parallel run.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';

import { DockerTestManager } from './docker-test-manager.js';

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function dockerAvailable(): boolean {
  try {
    docker('version', '--format', '{{.Server.Version}}');
    return true;
  } catch {
    return false;
  }
}

const describeOrSkip = dockerAvailable() ? describe : describe.skip;
if (!dockerAvailable()) {
  console.log('⏭️  Skipping docker-port-collision.spec.ts - requires Docker');
}

describeOrSkip('DockerTestManager host-port collision', () => {
  const manager = new DockerTestManager();
  const holderName = `port-holder-${process.pid}`;
  const probeName = `port-probe-${process.pid}`;

  afterAll(async () => {
    for (const name of [holderName, probeName]) {
      try {
        docker('rm', '-f', name);
      } catch {
        // already gone
      }
    }
  });

  it('re-draws an auto port and starts anyway when docker refuses the first one', async () => {
    // Take a port with a real container, the way a parallel suite would.
    const taken = await (manager as any).findAvailablePort();
    await manager.createContainer({
      name: holderName,
      image: 'redis:7-alpine',
      ports: { 6379: taken },
    });

    // Hand the next container that same port on its first draw. This is the
    // race made deterministic: the availability check said yes, and by the time
    // docker runs the port is gone.
    const original = (manager as any).findAvailablePort.bind(manager);
    let firstDraw = true;
    const spy = vi.spyOn(manager as any, 'findAvailablePort').mockImplementation(async () => {
      if (firstDraw) {
        firstDraw = false;
        return taken;
      }
      return original();
    });

    const container = await manager.createContainer({
      name: probeName,
      image: 'redis:7-alpine',
      ports: { 6379: 'auto' },
    });

    // Before the retry this threw "port is already allocated" and the whole
    // suite failed for a reason that had nothing to do with it.
    expect(container).toBeDefined();
    const published = docker('port', probeName, '6379/tcp');
    expect(published).not.toContain(`:${taken}`);
    expect(spy.mock.calls.length).toBeGreaterThan(1);
  }, 120_000);
});
