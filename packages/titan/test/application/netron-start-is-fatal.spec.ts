/**
 * An application that cannot bind its transport has not started.
 *
 * `Application.start()` wrapped `netron.start()` in a try/catch that logged a
 * warning, under a comment reading "Failure is non-fatal". For a backend
 * whose reason to exist is serving RPC it is the opposite, and everything
 * downstream believed the lie. Measured on the dev stand 2026-09-11, where a
 * restart raced the previous process's shutdown and lost the port:
 *
 *   07:39:03.299  error  Failed to start http server
 *   07:39:03.300  warn   Failed to start Netron service
 *   07:39:03.348  info   Application started successfully
 *
 * titan-pm's `waitForReady` resolved on that, the supervisor registered a
 * healthy child, and `omnitron list` reported the app ONLINE on port 3005
 * with nothing listening. The stack read 6/6 green while one backend served
 * nothing at all. A failure that leaves every monitor agreeing is worse than
 * a crash.
 */
import { describe, it, expect } from 'vitest';

import { Application } from '../../src/application/application.js';
import { NETRON_TOKEN } from '../../src/application/index.js';
import { Container } from '../../src/nexus/index.js';

const silent: any = {
  info: () => undefined, warn: () => undefined, error: () => undefined,
  debug: () => undefined, trace: () => undefined, fatal: () => undefined,
  child: () => silent,
};

/** A Netron whose transport refuses to bind, the way EADDRINUSE does. */
function unbindableNetron() {
  return {
    start: async () => {
      throw new Error('listen EADDRINUSE: address already in use :::3005');
    },
    stop: async () => undefined,
    peer: { exposeService: async () => undefined },
  };
}

async function appWith(netron: unknown) {
  const container = new Container();
  container.register(NETRON_TOKEN, { useValue: netron });
  return Application.create({ name: 'probe', logger: silent, container } as never);
}

describe('Application.start with a Netron that cannot bind', () => {
  it('fails, rather than reporting a started application', async () => {
    const app = await appWith(unbindableNetron());

    await expect(app.start()).rejects.toThrow(/Netron service failed to start/);
  });

  it('says the application cannot serve RPC', async () => {
    // The message is what an operator reads at 3am next to a green dashboard.
    const app = await appWith(unbindableNetron());

    await expect(app.start()).rejects.toThrow(/cannot serve RPC/);
  });

  it('keeps the underlying cause', async () => {
    const app = await appWith(unbindableNetron());
    const err = await app.start().catch((e: Error) => e);

    expect((err as Error & { cause?: Error }).cause?.message).toContain('EADDRINUSE');
  });

  it('starts normally when Netron starts', async () => {
    // A client-only Netron has no server configs, so `start()` resolves — the
    // change must not turn that into a failure.
    let started = false;
    const app = await appWith({
      start: async () => { started = true; },
      stop: async () => undefined,
      peer: { exposeService: async () => undefined },
    });

    await app.start();
    expect(started).toBe(true);
  });
});
