/**
 * Auto-exposure walks container registrations, and one class is often
 * registered twice — under its own class token and under a symbolic one, which
 * is how most of this platform's services are wired. Both registrations resolve
 * the SAME instance, so the second `exposeService` call was refused with
 * "Service instance already exposed" and reported as a warning, on every boot,
 * for as long as the pattern has existed. Nothing was lost — the first
 * exposure stands — and nothing was gained by saying so.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Application } from '../../src/application.js';
import { ApplicationState } from '../../src/types.js';
import { Module, Injectable, Service } from '../../src/decorators/index.js';
import { createToken } from '../../src/nexus/index.js';

const ALIAS = createToken<ExposedTwice>('ExposureAliasToken');

@Injectable()
@Service({ name: 'ExposedTwice', version: '1.0.0' })
class ExposedTwice {
  ping(): string {
    return 'pong';
  }
}

@Module({
  providers: [ExposedTwice, [ALIAS, { useClass: ExposedTwice }]],
  exports: [ALIAS],
})
class DoubleRegisteredModule {}

describe('Application service auto-exposure', () => {
  let app: Application;

  afterEach(async () => {
    if (app && app.state === ApplicationState.Started) await app.stop({ force: true });
  });

  it('attempts the exposure once, not once per registration', async () => {
    app = await Application.create({ imports: [DoubleRegisteredModule], disableGracefulShutdown: true });

    const peer = app.netron!.peer as unknown as { exposeService: (instance: unknown) => Promise<unknown> };
    const original = peer.exposeService.bind(peer);
    const attempts: unknown[] = [];
    let rejected = 0;
    peer.exposeService = async (instance: unknown) => {
      attempts.push(instance);
      try {
        return await original(instance);
      } catch (error) {
        rejected++;
        throw error;
      }
    };

    await app.start();

    const ours = attempts.filter((instance) => instance instanceof ExposedTwice);
    expect(ours, 'the same instance was offered to Netron twice').toHaveLength(1);
    expect(rejected, 'a conflict was raised and swallowed').toBe(0);
    expect(app.netron?.services.has('ExposedTwice@1.0.0'), 'the service is exposed').toBe(true);
  });
});
