/**
 * Regression test for T#58 — Docker `--restart=always` /
 * `--restart=on-failure` puts a container into the transient
 * `restarting` state between exit and re-entry. The 30-second
 * health sweep used to interpret any non-`running` status as
 * "service down, recreate" and immediately call `removeContainer`
 * + `createAndStart`, racing Docker's own restart cycle. Outcomes
 * observed in production:
 *   - removeContainer mid-restart left the daemon in a confused
 *     state and the recreated container sometimes shadowed under
 *     a transient renamed container, producing duplicates;
 *   - the sweep's createAndStart occasionally hit name conflicts
 *     when Docker's restart finished first.
 *
 * Fix
 * - In `healthSweep`, treat `actual.status === 'restarting'` as
 *   "Docker is already handling it — yield". Next 30s tick re-checks.
 * - Add a per-name in-flight lock around `reconcileService` so two
 *   concurrent sweeps can't both recreate the same container.
 *
 * These tests mock `getContainerState` (and friends) at the module
 * boundary so we can exercise the branches without real Docker.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the entire container-runtime module so the Docker shell-out
// path never runs in this test. Every export becomes a vi.fn() we
// can program per-case.
vi.mock('../../src/infrastructure/container-runtime.js', () => ({
  getContainerState: vi.fn(),
  removeContainer: vi.fn().mockResolvedValue(undefined),
  startContainer: vi.fn().mockResolvedValue(undefined),
  isDockerAvailable: vi.fn().mockResolvedValue(true),
  createContainer: vi.fn().mockResolvedValue('cid'),
  inspectContainer: vi.fn().mockResolvedValue(null),
  pullImage: vi.fn().mockResolvedValue(undefined),
  createVolume: vi.fn().mockResolvedValue(undefined),
  imageExists: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/infrastructure/service-resolver.js', () => ({
  resolveInfrastructure: vi.fn().mockReturnValue([]),
  resolveOmnitronPg: vi.fn().mockReturnValue({
    name: 'omnitron-pg',
    image: 'postgres:16',
    env: {},
    ports: [],
    volumes: [],
    network: undefined,
    healthcheck: undefined,
    restart: 'always',
  }),
}));

import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import * as runtime from '../../src/infrastructure/container-runtime.js';

const logger: any = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => logger,
};

function mkSvc(): InfrastructureService {
  const svc: any = new InfrastructureService(logger, { services: {} } as any);
  // Replant a single fake desired container so the sweep has
  // something concrete to reconcile.
  svc.desiredContainers.length = 0;
  svc.desiredContainers.push({
    name: 'test-svc',
    image: 'busybox:latest',
    env: {},
    ports: [],
    volumes: [],
    network: undefined,
    healthcheck: undefined,
    restart: 'always',
  });
  // Force the "global pg already running" branch so we don't try to
  // include omnitron-pg in the sweep.
  svc.usingGlobalOmnitronPg = true;
  return svc;
}

describe('InfrastructureService — health sweep (T#58)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("yields to Docker when the container is in 'restarting' (no recreate)", async () => {
    const svc: any = mkSvc();
    // Container status flips to 'restarting' because Docker is
    // bringing it back up after an exit.
    (runtime.getContainerState as any).mockResolvedValue({
      name: 'test-svc',
      status: 'restarting',
      health: 'unhealthy',
      containerId: 'c1',
      image: 'busybox:latest',
    });

    await svc.healthSweep();

    // The sweep MUST NOT have called removeContainer (which would
    // have raced Docker's restart and left state corrupt).
    expect(runtime.removeContainer).not.toHaveBeenCalled();
  });

  it('locks reconcileService per-name against concurrent ticks', async () => {
    const svc: any = mkSvc();
    let resolveFirstGetState: ((s: any) => void) | undefined;
    let callCount = 0;
    (runtime.getContainerState as any).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // The first reconcile holds inside getContainerState long
        // enough for a second concurrent reconcile to fire.
        return new Promise((r) => {
          resolveFirstGetState = r;
        });
      }
      return Promise.resolve({
        name: 'test-svc',
        status: 'exited',
        health: 'none',
        containerId: 'c1',
        image: 'busybox:latest',
      });
    });

    // Fire two concurrent reconciles for the same container.
    const desired = svc.desiredContainers[0];
    const a = svc.reconcileService(desired);
    const b = svc.reconcileService(desired);

    // Allow microtasks to drain so both calls register their
    // lock check.
    await new Promise((r) => setImmediate(r));

    // Only the FIRST should have reached getContainerState; the
    // second short-circuited on the lock.
    expect(callCount).toBe(1);

    // Release the first reconcile and let both settle.
    resolveFirstGetState!({
      name: 'test-svc',
      status: 'running',
      health: 'healthy',
      containerId: 'c1',
      image: 'busybox:latest',
    });
    await Promise.all([a, b]);
  });
});
