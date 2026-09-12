/**
 * `@OnShutdown` marked a method and the runtime never called it.
 *
 * `serviceWrapper.__shutdown` finds handlers by scanning each method's entry
 * under PROCESS_METHOD_METADATA_KEY for an `onShutdown` field. The decorator
 * wrote to a different key entirely — the string `'on-shutdown'`, on the
 * prototype rather than per method — so the two never met. The runtime went
 * straight to `netron.stop()` and `process.exit(0)`, and an exit that skips
 * the cleanup a process asked for looks exactly like a clean one.
 *
 * This is the same defect `@HealthCheck` had, fixed four lines above in the
 * same file and not carried across.
 *
 * The suite had a test named "should call shutdown methods decorated with
 * @OnShutdown". It wrote the metadata BY HAND and then re-implemented the
 * runtime's loop inline, so it never touched the decorator — it certified the
 * loop while the thing meant to feed it wrote somewhere else. These go through
 * the real decorator and the real discovery.
 */

import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';

import { OnShutdown, HealthCheck, PROCESS_METHOD_METADATA_KEY } from '../../src/decorators.js';

/** Exactly what `serviceWrapper.__shutdown` does to find handlers. */
async function runShutdownHandlers(instance: object): Promise<string[]> {
  const prototype = Object.getPrototypeOf(instance);
  const called: string[] = [];
  for (const propertyName of Object.getOwnPropertyNames(prototype)) {
    if (propertyName === 'constructor') continue;
    const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, propertyName);
    if (metadata?.onShutdown) {
      await (instance as Record<string, () => unknown>)[propertyName]!();
      called.push(propertyName);
    }
  }
  return called;
}

describe('@OnShutdown reaches the runtime that looks for it', () => {
  it('is found by the scan the worker runtime performs', async () => {
    const flushed = vi.fn();

    class Worker {
      @OnShutdown()
      async flush() {
        flushed();
      }
    }

    const called = await runShutdownHandlers(new Worker());

    expect(flushed, 'the handler the process asked for never ran').toHaveBeenCalledTimes(1);
    expect(called).toEqual(['flush']);
  });

  it('runs every handler, not only the last one declared', async () => {
    // The prototype key was single-valued, so a second `@OnShutdown`
    // overwrote the first — a limit the runtime's per-method loop does not
    // have. The old test asserted that overwrite as intended behaviour.
    const order: string[] = [];

    class Worker {
      @OnShutdown()
      async closeFiles() {
        order.push('closeFiles');
      }

      @OnShutdown()
      async releaseLock() {
        order.push('releaseLock');
      }
    }

    const called = await runShutdownHandlers(new Worker());

    expect(called.sort()).toEqual(['closeFiles', 'releaseLock']);
    expect(order.sort()).toEqual(['closeFiles', 'releaseLock']);
  });

  it('keeps the prototype key any existing reader may use', () => {
    class Worker {
      @OnShutdown()
      async cleanup() {}
    }

    expect(Reflect.getMetadata('on-shutdown', Worker.prototype)).toBe('cleanup');
  });

  it('leaves an undecorated method alone', async () => {
    const ran = vi.fn();

    class Worker {
      async cleanup() {
        ran();
      }
    }

    expect(await runShutdownHandlers(new Worker())).toEqual([]);
    expect(ran).not.toHaveBeenCalled();
  });

  it('shares the metadata entry with the other lifecycle decorator', async () => {
    // Both write through `getOrCreateMethodMetadata`, so stacking them must
    // not make one clobber the other.
    class Worker {
      @HealthCheck({ interval: 5000 })
      @OnShutdown()
      async both() {}
    }

    const meta = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, Worker.prototype, 'both');
    expect(meta?.onShutdown).toBe(true);
    expect(meta?.healthCheck).toMatchObject({ method: 'both', interval: 5000 });
  });
});
