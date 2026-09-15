/**
 * A remote stack shipped its applications to a node with no database.
 *
 * `startRemoteStack` provisioned the daemon, shipped the artifacts and
 * opened the mesh connection. The stack's `infrastructure` block — its
 * Postgres, its Redis, its MinIO — was read by the master and never left it.
 * There was no way to send it: `OmnitronInfra` exposed reads and per-
 * container controls and nothing that could bring a set up.
 *
 * A node would not have acted on one either. A provisioned slave is started
 * with `--no-infra`, and the boot path is guarded by
 * `config.infrastructure && !isSlave`.
 *
 * So the applications started and had nothing to connect to, which surfaces
 * as every one of them failing its first query — not as a missing step.
 *
 * Everything needed was already on the node: `InfrastructureService`
 * reconciles containers, waits on health, detects a drifted spec and cleans
 * up phantom endpoints, over the `docker` CLI a provisioned node has. The
 * only thing missing was a way to ask.
 */

import { describe, it, expect, vi } from 'vitest';

import { InfrastructureRpcService } from '../../src/services/infrastructure.rpc-service.js';

/** An InfrastructureService stand-in that records what it was asked for. */
function fakeInfra(services: Record<string, unknown>, desired: Array<{ name: string; image?: string }>) {
  return {
    provisions: 0,
    provision: vi.fn(async function (this: any) {
      (this as any).provisions += 1;
      return { services, ready: true };
    }),
    getDesiredServices: () => desired,
    getState: () => ({ services, ready: true }),
  } as never;
}

const up = (name: string) => ({ name, image: `${name}:1`, status: 'running', health: 'healthy' });

const CONFIG = { postgres: { image: 'postgres:16', port: 5432 } } as never;

describe('asking a node to host a stack s infrastructure', () => {
  it('brings up what the stack declares and reports it', async () => {
    const infra = fakeInfra({ pg: up('pg'), redis: up('redis') }, [{ name: 'pg' }, { name: 'redis' }]);
    const host = vi.fn(() => infra);
    const service = new InfrastructureRpcService(() => null, host as never);

    const report = await service.provisionStack({ config: CONFIG });

    expect(host).toHaveBeenCalledWith(CONFIG);
    expect(report.ready).toBe(true);
    expect(report.running.sort()).toEqual(['pg', 'redis']);
    expect(report.missing).toEqual([]);
  });

  it('names what did not come up, rather than reporting success', async () => {
    const infra = fakeInfra({ pg: { name: 'pg', image: 'pg:1', status: 'exited', error: 'no such image' } }, [
      { name: 'pg' }, { name: 'redis' },
    ]);
    const service = new InfrastructureRpcService(() => null, (() => infra) as never);

    const report = await service.provisionStack({ config: CONFIG });

    // The master decides whether to deploy applications onto this node from
    // exactly this answer.
    expect(report.ready).toBe(false);
    expect(report.failed).toEqual([{ name: 'pg', status: 'exited', error: 'no such image' }]);
    expect(report.missing).toEqual(['redis']);
    expect(report.detail).toMatch(/NOT ready/i);
  });

  it('reuses the infrastructure this node already has', async () => {
    const infra = fakeInfra({ pg: up('pg') }, [{ name: 'pg' }]);
    const host = vi.fn();
    const service = new InfrastructureRpcService(() => infra, host as never);

    await service.provisionStack({ config: CONFIG });
    await service.provisionStack({ config: CONFIG });

    // Reconciliation is idempotent, but building a second service is not:
    // it would give one node two janitors and two health monitors over one
    // set of containers.
    expect(host).not.toHaveBeenCalled();
    expect((infra as any).provisions).toBe(2);
  });

  it('refuses on a daemon that does not host one', async () => {
    const service = new InfrastructureRpcService(() => null);

    // A master provisions its own from its own config at boot. Saying so is
    // the difference between "this node does not do that" and "it worked".
    await expect(service.provisionStack({ config: CONFIG })).rejects.toThrow(/does not host/i);
  });

  it('refuses a call with no config', async () => {
    const service = new InfrastructureRpcService(() => null, (() => fakeInfra({}, [])) as never);

    await expect(service.provisionStack({} as never)).rejects.toThrow(/requires an .?infrastructure/i);
  });
});
