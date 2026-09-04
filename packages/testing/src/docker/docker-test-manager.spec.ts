/**
 * Cleanup must remove this manager's containers and nothing else.
 *
 * DockerTestManager used to select what to remove with
 * `--filter label=test.cleanup=true`, a label every test container on the
 * machine carries. Under `vitest --pool=forks` each worker builds its own
 * manager, so whichever worker finished first deleted the containers the other
 * workers were still using. The symptom was unhelpfully calm: Redis exits 0 on
 * SIGTERM, so the victim saw "container exited with exit code 0" and read like
 * a flaky test rather than a killed dependency.
 *
 * Every cleanup filter is now scoped by a per-manager `test.manager` label.
 * That is six separate filters, and reverting any one of them restores the
 * old behaviour silently — so this test stands in for the other workers by
 * creating a container labelled as belonging to a different manager, and
 * requires it to survive.
 */

import { describe, it, expect, afterAll } from 'vitest';
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
  console.log('⏭️  Skipping docker-test-manager.spec.ts - requires Docker');
}

describeOrSkip('DockerTestManager cleanup scope', () => {
  const foreignName = `foreign-worker-probe-${process.pid}`;

  afterAll(() => {
    try {
      docker('rm', '-f', foreignName);
    } catch {
      // already gone
    }
  });

  it('can wait for a container that has no healthcheck', async () => {
    // `waitFor.healthcheck: false` means "wait until it is running". It could
    // not work: the inspect template asked for `.State.Health.Status`, Go
    // templates fail on a missing key, and the swallowed error left every
    // healthcheck-less container reported as not running. The rejection named
    // an exit code that did not exist — "Container exited with status
    // 'undefined' and exit code undefined" — for a container that was up.
    const manager = DockerTestManager.getInstance();

    const container = await manager.createContainer({
      name: `no-healthcheck-probe-${process.pid}`,
      image: 'redis:7-alpine',
      ports: { 6379: 'auto' },
      waitFor: { healthcheck: false, timeout: 30_000 },
    });

    expect(docker('inspect', '-f', '{{.State.Running}}', container.name)).toBe('true');

    await manager.cleanupAll();
  }, 120_000);

  it('leaves another manager\'s containers alone when the process exits', async () => {
    // The damage was done by the `process.on('exit')` handler, which runs
    // `cleanupSync` — the only path that selects by label rather than by this
    // manager's own registry. `cleanupAll()` iterates `this.containers` and was
    // never the problem, so a test driving it would pass with the bug present.
    // Called directly here because a real process exit cannot be observed from
    // inside the process that is exiting.
    try {
      docker('rm', '-f', foreignName);
    } catch {
      // not there yet
    }
    docker(
      'run', '-d', '--name', foreignName,
      '--label', 'test.cleanup=true',
      '--label', 'test.manager=some-other-worker',
      'redis:7-alpine'
    );

    const manager = DockerTestManager.getInstance();
    const own = await manager.createContainer({
      name: `own-worker-probe-${process.pid}`,
      image: 'redis:7-alpine',
      ports: { 6379: 'auto' },
      waitFor: { healthcheck: false, timeout: 30_000 },
    });

    expect(docker('ps', '-a', '--filter', `name=${own.name}`, '-q')).not.toBe('');

    (manager as unknown as { cleanupSync(): void }).cleanupSync();

    // Ours is gone...
    expect(docker('ps', '-a', '--filter', `name=${own.name}`, '-q')).toBe('');

    // ...and the other worker's is untouched and still running.
    expect(docker('ps', '--filter', `name=${foreignName}`, '-q')).not.toBe('');
    expect(docker('inspect', '-f', '{{.State.Running}}', foreignName)).toBe('true');
  }, 120_000);
});
