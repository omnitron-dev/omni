/**
 * A database the health sweep brought back.
 *
 * A node's daemon keeps its own state in SQLite, so the infrastructure it
 * hosts for a stack keeps no control-plane Postgres: `provision()` asks
 * `needsControlPlaneDatabase` and skips it (63115a4f). The health sweep and
 * the teardown did not ask — only whether the global `omnitron-pg` serves —
 * so on a node the sweep found `<prefix>-pg` «not running» every 30 s and
 * created it. daos/test got one on 2026-09-20, and again on 2026-09-25 forty
 * seconds after it had been removed: «Service not running — auto-restarting
 * {service: daos-test-pg}», on the default credentials, for a database
 * nothing reads.
 *
 * Held here with a real InfrastructureService, only docker's answers faked:
 * on a node the sweep restarts the stack's services and never the
 * control-plane database; on a master it still does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ running: new Set<string>() }));
vi.mock('../../src/infrastructure/container-runtime.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getContainerState: async (name: string) => (state.running.has(name) ? { name, status: 'running' } : null),
}));

import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { setContainerPrefix } from '../../src/infrastructure/service-resolver.js';

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => quiet() }) as never;

const redis = { redis: { ports: { main: 6379 }, env: {}, docker: { image: 'redis:7' } } };

function sweepOf(needsControlPlaneDatabase: boolean) {
  setContainerPrefix('daos', 'test');
  const svc = new InfrastructureService(quiet(), { services: redis } as never, redis as never, undefined, undefined, needsControlPlaneDatabase);
  const restarted: string[] = [];
  (svc as unknown as { reconcileService: (d: { name: string }) => Promise<void> }).reconcileService = async (d) => {
    restarted.push(d.name);
  };
  return { sweep: () => (svc as unknown as { healthSweep(): Promise<void> }).healthSweep(), restarted };
}

beforeEach(() => state.running.clear());

describe('the health sweep', () => {
  it('on a node, restarts the stack\'s services and never the control-plane database', async () => {
    const { sweep, restarted } = sweepOf(false);
    await sweep();
    expect(restarted).toEqual(['daos-test-redis']);
  });

  it('on a master, still keeps the control-plane database up', async () => {
    const { sweep, restarted } = sweepOf(true);
    await sweep();
    expect(restarted).toEqual(['daos-test-pg', 'daos-test-redis']);
  });

  it('leaves alone what is running', async () => {
    state.running.add('daos-test-redis');
    state.running.add('daos-test-pg');
    const { sweep, restarted } = sweepOf(true);
    await sweep();
    expect(restarted).toEqual([]);
  });
});
