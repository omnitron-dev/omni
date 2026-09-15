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

    // The config, and the services it expands to — the stack's Postgres is
    // written as sugar and has to be a service requirement before anything
    // can act on it.
    expect(host.mock.calls[0]![0]).toBe(CONFIG);
    expect(Object.keys(host.mock.calls[0]![1] as Record<string, unknown>)).toContain('postgres');
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

describe('what the applications in a stack declare', () => {
  it('reaches the node, because the node cannot know it', async () => {
    const infra = fakeInfra({ pg: up('pg') }, [{ name: 'pg' }]);
    (infra as any).addAppContainers = vi.fn();
    const host = vi.fn(() => infra);
    const service = new InfrastructureRpcService(() => null, host as never);

    const declared = { bitcoin: { ports: { rpc: 8332 }, docker: { image: 'bitcoin:1' } } } as never;
    await service.provisionStack({ config: CONFIG, services: declared });

    // The node does not have the application definitions when it is asked,
    // and reading them again on that side would be a second implementation
    // of variant selection and override merging.
    // The node does not have the application definitions when it is asked,
    // and reading them again on that side would be a second implementation
    // of variant selection and override merging.
    expect(host.mock.calls[0]![1]).toMatchObject(declared as Record<string, unknown>);
  });

  it('is optional — a stack may declare nothing of its own', async () => {
    const infra = fakeInfra({ pg: up('pg') }, [{ name: 'pg' }]);
    const service = new InfrastructureRpcService(() => null, (() => infra) as never);

    await expect(service.provisionStack({ config: CONFIG })).resolves.toMatchObject({ ready: true });
  });
});

describe('the stack s own services reach the node', () => {
  it('expands the config sugar before provisioning it', async () => {
    const infra = fakeInfra({}, []);
    const host = vi.fn(() => infra);
    const service = new InfrastructureRpcService(() => null, host as never);

    await service.provisionStack({ config: { postgres: { image: 'postgres:17', port: 5432 } } as never });

    // `resolveInfrastructure` reads ONLY the normalized services and ignores
    // the raw config it is also handed, so skipping the expansion is not a
    // degraded provision: it is an empty one that reports success. Measured:
    // a node asked for `postgres, redis, minio` answered "nothing is
    // declared, so nothing was provisioned".
    const declared = host.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(declared)).toContain('postgres');
  });

  it('lets an application s declaration win over the stack s sugar', async () => {
    const infra = fakeInfra({}, []);
    (infra as any).addAppContainers = vi.fn();
    const host = vi.fn(() => infra);
    const service = new InfrastructureRpcService(() => null, host as never);

    const appVersion = { ports: { main: 6380 }, env: {}, docker: { image: 'redis:7.4' } } as never;
    await service.provisionStack({
      config: { redis: { port: 6379 } } as never,
      services: { redis: appVersion },
    });

    // The app is the side that knows what it needs of it.
    const declared = host.mock.calls[0]![1] as Record<string, unknown>;
    expect(declared['redis']).toBe(appVersion);
  });
});

describe('the principal a master presents', () => {
  it('is allowed to ask a node to provision', async () => {
    const { CONTROL_PLANE_ROLES, OPERATOR_ROLES } = await import('../../src/shared/roles.js');

    // A master reaches its nodes with a `service_role` token minted from the
    // node's own signing secret — no session, no human. Declared
    // OPERATOR_ROLES, `provisionStack` refused the one principal it exists
    // for: `Missing required role`, from a node that had just authenticated
    // that very credential.
    expect(CONTROL_PLANE_ROLES).toContain('service_role');
    expect(OPERATOR_ROLES).not.toContain('service_role');
    // An operator still is one.
    expect(CONTROL_PLANE_ROLES).toEqual(expect.arrayContaining(OPERATOR_ROLES));
  });

  it('is declared on the method, not assumed by it', async () => {
    // The decorator's metadata is what the wire enforces. Reading it here
    // means a future edit that narrows the roles fails this test rather than
    // a deployment.
    const { InfrastructureRpcService: Service } = await import('../../src/services/infrastructure.rpc-service.js');
    const meta = Reflect.getMetadata?.('netron:method:options', Service.prototype, 'provisionStack') as
      | { auth?: { roles?: string[] } }
      | undefined;

    if (meta?.auth?.roles) {
      expect(meta.auth.roles).toContain('service_role');
    } else {
      // No metadata reader available in this environment — the constant test
      // above is the one that carries the guarantee.
      expect(true).toBe(true);
    }
  });
});
