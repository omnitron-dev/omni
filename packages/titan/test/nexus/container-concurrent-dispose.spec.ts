/**
 * `Container.dispose()` guards on `this.disposed`, which it assigns only after
 * emitting ContainerDisposing, disposing every module and disposing every
 * instance. Two concurrent calls — a signal handler and an explicit shutdown,
 * SIGTERM followed by SIGINT, a test teardown racing an app stop — both passed
 * the guard and ran the whole teardown, so every `onDispose` hook and every
 * user `onDestroy`/`dispose` ran twice. Disposers are rarely idempotent:
 * closing a pool twice throws, a flush runs twice, a counter goes negative.
 *
 * The flag cannot simply be set earlier: `checkDisposed()` throws
 * `ContainerDisposedError`, so a container marked disposed before its teardown
 * would reject the `resolve()` calls its own onDispose hooks and module
 * disposers legitimately make. The second caller joins the in-flight disposal
 * instead — and joins rather than throws, because a caller asking for disposal
 * wants it done, not refused.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'reflect-metadata';

import { Container, createToken } from '../../src/nexus/index.js';

describe('Container - concurrent dispose', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  it('runs the teardown once when dispose() is called twice concurrently', async () => {
    const onDispose = vi.fn(async () => {
      // Long enough that the second dispose() enters while this one is awaiting.
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    container.addHook('onDispose', onDispose);

    const destroyed = vi.fn();
    const token = createToken<{ onDestroy: () => void }>('Disposable');
    container.register(token, { useValue: { onDestroy: destroyed } });
    container.resolve(token);

    await Promise.all([container.dispose(), container.dispose()]);

    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(destroyed).toHaveBeenCalledTimes(1);
  });

  it('still resolves for a caller that disposes an already-disposed container', async () => {
    const onDispose = vi.fn();
    container.addHook('onDispose', onDispose);

    await container.dispose();
    await container.dispose();

    expect(onDispose).toHaveBeenCalledTimes(1);
  });
});
