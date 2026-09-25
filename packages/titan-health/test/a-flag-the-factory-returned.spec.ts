/**
 * A flag the factory returned.
 *
 * `TitanHealthModule.forRootAsync` registers its providers when the module is
 * built and runs the factory later, when they are resolved. It decided whether
 * to register `HealthRpcService` without looking at `enableRpcService` at all —
 * the only place a caller could put the flag was the factory's result, which
 * arrives after that decision. daos storage and paysys return
 * `enableRpcService: false` («We use our own RPC service»), and since omni
 * 0c9eec37 put factory-built services on the wire, both served
 * `Health@1.0.0.check` — heap used, heap limit, the thresholds, uptime — to
 * anonymous callers through the public gateway, with main and messaging
 * (measured on the daos dev stand, 2026-09-25).
 *
 * Held here, through the real exposure path (an Application that starts): the
 * flag read at registration takes the service off the wire; the default keeps
 * it on; a factory's `false` alone leaves it registered and answering nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { Application } from '@omnitron-dev/titan';

import { TitanHealthModule } from '../src/health.module.js';
import { HealthRpcService } from '../src/health.rpc-service.js';

let app: Application | undefined;

afterEach(async () => {
  await app?.stop({ force: true }).catch(() => undefined);
  app = undefined;
});

/** The names of the services this application put on the wire. */
function exposedNames(started: Application): string[] {
  const peer = started.netron!.peer as unknown as {
    services?: Map<string, unknown>;
    stubs?: Map<string, { definition?: { meta?: { name?: string } } }>;
  };
  if (peer.stubs) return [...peer.stubs.values()].map((s) => s.definition?.meta?.name ?? '').filter(Boolean);
  return [...(peer.services?.keys() ?? [])];
}

const start = async (health: ReturnType<typeof TitanHealthModule.forRootAsync>) => {
  app = await Application.create({ imports: [health], disableGracefulShutdown: true });
  await app.start();
  return app;
};

const health = (names: string[]) => names.filter((n) => n.startsWith('Health'));

describe('forRootAsync and enableRpcService', () => {
  it('false at registration: Health is not on the wire', async () => {
    const started = await start(
      TitanHealthModule.forRootAsync({
        enableRpcService: false,
        useFactory: () => ({ enableEventLoopIndicator: false }),
      })
    );
    expect(health(exposedNames(started))).toEqual([]);
  });

  it('by default: Health is on the wire (the control)', async () => {
    const started = await start(
      TitanHealthModule.forRootAsync({ useFactory: () => ({ enableEventLoopIndicator: false }) })
    );
    expect(health(exposedNames(started))).not.toEqual([]);
  });

  it('false from the factory alone: registered, and answers every call as a missing service', async () => {
    // Provider lists are fixed before the factory runs, so the service cannot
    // be taken off the wire here — and failing the boot instead would strand
    // every node whose daemon arrives before the application that moves the
    // flag. What it can do is say nothing.
    const started = await start(
      TitanHealthModule.forRootAsync({
        useFactory: () => ({ enableRpcService: false, enableEventLoopIndicator: false }),
      })
    );
    const rpc = await started.resolveAsync(HealthRpcService);
    for (const call of [() => rpc.check(), () => rpc.live(), () => rpc.ready(), () => rpc.listIndicators()]) {
      await expect(call()).rejects.toThrow(/Service Health@1.0.0 not found/);
    }
  });

  it('the same value in both places is not an error', async () => {
    const started = await start(
      TitanHealthModule.forRootAsync({
        enableRpcService: false,
        useFactory: () => ({ enableRpcService: false, enableEventLoopIndicator: false }),
      })
    );
    expect(health(exposedNames(started))).toEqual([]);
  });
});
