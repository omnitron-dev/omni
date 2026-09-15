/**
 * A `@Service` registered through `useFactory` was never put on the wire.
 *
 * Auto-exposure walks container registrations and reads the class off each
 * PROVIDER: a bare class, a `useClass`, or the constructor of a `useValue`. A
 * `useFactory` provider is just a function — nothing about it names the class
 * it builds — so `extractServiceClass` returned null and the registration was
 * skipped. The service was constructed, held in the container, and
 * unreachable.
 *
 * Observed on a live `main`: `HealthModule.forRootAsync` registers
 * `HealthRpcService` with `useFactory`, while the synchronous `forRoot` uses
 * `useValue` and was handled. So `Health@1.0.0`, `HealthService` and `Health`
 * all answered 404 — verified twice, weeks apart, the second time against a
 * healthy running process whose other RPCs answered in 120 ms — while that
 * module's database and Redis indicators ran on a timer for nobody. The app
 * that owns orders, escrow and delivery had no readiness answer at all, and
 * its HTTP `/health` is titan's LIVENESS probe, which is alive by
 * construction.
 *
 * Modules register such providers under the class itself, so the token IS the
 * class and carries the decorator's metadata. No resolution is needed to find
 * it, which matters: the two-pass design exists so that discovery does not
 * depend on resolution order.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Application } from '../../src/application.js';
import { ApplicationState } from '../../src/types.js';
import { Module, Injectable, Service } from '../../src/decorators/index.js';
import { createToken } from '../../src/nexus/index.js';

@Injectable()
@Service({ name: 'BuiltByFactory', version: '1.0.0' })
class BuiltByFactory {
  ping(): string {
    return 'pong';
  }
}

@Injectable()
@Service({ name: 'BuiltDirectly', version: '1.0.0' })
class BuiltDirectly {
  ping(): string {
    return 'pong';
  }
}

/** A factory-provided service filed under its own class, as modules do. */
@Module({
  providers: [
    [BuiltByFactory, { useFactory: () => new BuiltByFactory() }],
    BuiltDirectly,
  ],
})
class FactoryModule {}

const OPAQUE = createToken<BuiltByFactory>('OpaqueFactoryToken');

/** A factory filed under a symbolic token: nothing names the class. */
@Module({
  providers: [[OPAQUE, { useFactory: () => new BuiltByFactory() }]],
})
class OpaqueFactoryModule {}

async function exposedNames(app: Application): Promise<string[]> {
  const peer = app.netron!.peer as unknown as { services?: Map<string, unknown> };
  const stubs = (app.netron!.peer as unknown as { stubs?: Map<string, { definition?: { meta?: { name?: string } } }> })
    .stubs;
  if (stubs) {
    return [...stubs.values()].map((s) => s.definition?.meta?.name ?? '').filter(Boolean);
  }
  return [...(peer.services?.keys() ?? [])];
}

describe('a @Service built by a factory reaches the wire', () => {
  let app: Application;

  afterEach(async () => {
    if (app && app.state === ApplicationState.Started) await app.stop({ force: true });
  });

  it('is exposed when the factory is filed under the service class', async () => {
    app = await Application.create({ imports: [FactoryModule], disableGracefulShutdown: true });
    await app.start();

    const names = await exposedNames(app);
    expect(names, 'the control: a plain class registration').toContain('BuiltDirectly');
    expect(names, 'the token is the class, and it carries @Service').toContain('BuiltByFactory');
  });

  it('and a factory under a symbolic token is still skipped, knowingly', async () => {
    // Nothing names the class here without resolving the factory, and
    // resolving every factory at discovery time is what the two-pass design
    // avoids. Recorded as a decision so the next reader does not take it for
    // an oversight.
    app = await Application.create({ imports: [OpaqueFactoryModule], disableGracefulShutdown: true });
    await app.start();

    expect(await exposedNames(app)).not.toContain('BuiltByFactory');
  });
});
