/**
 * Regression test for T#72 — collapse 3 event systems into one.
 *
 * Pre-T#72 the framework had three independent event-bus implementations:
 *
 *   1. `EnhancedEventEmitter` from `@omnitron-dev/eventemitter` (foundational
 *      primitive used by netron, transports, multi-backend)
 *   2. `EventBusService` from `@omnitron-dev/titan-events` (DI-driven
 *      service with decorators, validation, scheduling)
 *   3. `Application._internal/EventBus` from `titan` (lifecycle bus —
 *      a 245-line WRAPPER that reimplemented wildcard fan-out, dispatch
 *      loops, and error-handler chains the primitive already supported)
 *
 * The third was the redundant one. The T#72 collapse routes the
 * Application's lifecycle events through the SAME canonical primitive
 * (#1), with the small Application-specific extensions (error-handler
 * chain, `IEventMeta` shape) layered ON TOP via subclass instead of
 * reimplementation.
 *
 * This file pins the invariants the collapse guarantees:
 *   - The Application's internal event bus IS an `EnhancedEventEmitter`.
 *   - It satisfies the canonical `IEventBus` and `IAsyncEventBus`
 *     interfaces — the contract that unifies every event-bus
 *     implementation in the framework.
 *   - Legacy behaviour (wildcard `'*'` fan-out, error-handler chain,
 *     `IEventMeta` arg shape) survives the refactor.
 */

import { describe, it, expect } from 'vitest';
import {
  EnhancedEventEmitter,
  type IAsyncEventBus,
  type IEventBus,
} from '@omnitron-dev/eventemitter';
import { Application } from '../../src/application/application.js';
import { ApplicationEvent } from '../../src/types.js';

describe('T#72 unified event bus — Application uses EnhancedEventEmitter', () => {
  it('the internal event bus is an instance of EnhancedEventEmitter', async () => {
    const app = new Application({ disableGracefulShutdown: true, disableCoreModules: true });
    // The internal collaborator lives under `_events` — accessed via `as any`
    // since it's an `@internal` field.
    const bus = (app as any)._events;
    expect(bus).toBeInstanceOf(EnhancedEventEmitter);
  });

  it('the internal event bus satisfies the canonical IEventBus contract', async () => {
    const app = new Application({ disableGracefulShutdown: true, disableCoreModules: true });
    const bus = (app as any)._events as IEventBus;
    expect(typeof bus.on).toBe('function');
    expect(typeof bus.once).toBe('function');
    expect(typeof bus.off).toBe('function');
    expect(typeof bus.emit).toBe('function');
    expect(typeof bus.listeners).toBe('function');
    expect(typeof bus.listenerCount).toBe('function');
    expect(typeof bus.removeAllListeners).toBe('function');
  });

  it('the internal event bus satisfies IAsyncEventBus (parallel/serial emit)', async () => {
    const app = new Application({ disableGracefulShutdown: true, disableCoreModules: true });
    const bus = (app as any)._events as IAsyncEventBus;
    expect(typeof bus.emitParallel).toBe('function');
    expect(typeof bus.emitSerial).toBe('function');
  });

  it('wildcard listeners on `*` receive every ApplicationEvent', async () => {
    const app = new Application({ disableGracefulShutdown: true, disableCoreModules: true });
    const seen: string[] = [];
    app.on('*' as any, (_data: unknown, meta: any) => {
      seen.push(meta.event);
    });
    app.emit(ApplicationEvent.Starting);
    app.emit(ApplicationEvent.ModuleRegistered, { module: 'fixture' });
    app.emit(ApplicationEvent.ShutdownStart, { reason: 'test' });
    expect(seen).toEqual([
      ApplicationEvent.Starting,
      ApplicationEvent.ModuleRegistered,
      ApplicationEvent.ShutdownStart,
    ]);
  });

  it('listeners receive `(data, meta)` with `meta.event` carrying the original event name', async () => {
    const app = new Application({ disableGracefulShutdown: true, disableCoreModules: true });
    let captured: { data: unknown; meta: any } | null = null;
    app.on(ApplicationEvent.ModuleStarted, (data: unknown, meta: any) => {
      captured = { data, meta };
    });
    app.emit(ApplicationEvent.ModuleStarted, { module: 'logger' });
    expect(captured).not.toBeNull();
    expect(captured!.data).toEqual({ module: 'logger' });
    expect(captured!.meta.event).toBe(ApplicationEvent.ModuleStarted);
    expect(typeof captured!.meta.timestamp).toBe('number');
    expect(captured!.meta.source).toBe('application');
  });

  it('Application.onError registers a handler that fires on Error events', async () => {
    const app = new Application({ disableGracefulShutdown: true, disableCoreModules: true });
    const seen: Error[] = [];
    app.onError((err) => { seen.push(err); });
    const boom = new Error('boom');
    app.emit(ApplicationEvent.Error, boom);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(boom);
  });

  it('onError handlers fire alongside ordinary `on(Error, ...)` subscribers', async () => {
    const app = new Application({ disableGracefulShutdown: true, disableCoreModules: true });
    const chainSeen: Error[] = [];
    const listenerSeen: Error[] = [];
    app.onError((err) => { chainSeen.push(err); });
    app.on(ApplicationEvent.Error as any, (data: unknown) => {
      if (data instanceof Error) listenerSeen.push(data);
    });
    const boom = new Error('both paths');
    app.emit(ApplicationEvent.Error, boom);
    expect(chainSeen).toEqual([boom]);
    expect(listenerSeen).toEqual([boom]);
  });

  it('async emit awaits every listener in parallel', async () => {
    const app = new Application({ disableGracefulShutdown: true, disableCoreModules: true });
    const order: string[] = [];
    app.on(ApplicationEvent.Custom as any, async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('slow');
    });
    app.on(ApplicationEvent.Custom as any, () => {
      order.push('fast');
    });
    await app.emitAsync(ApplicationEvent.Custom as any, { kind: 'parallel' });
    // Fast handler resolves immediately; slow handler after 20ms.
    // Parallel emit waits for both — order is fast, slow.
    expect(order).toEqual(['fast', 'slow']);
  });

  it('a throwing wildcard handler does NOT recurse on the resulting Error event', async () => {
    // Reproduces the bug T#33's refactor introduced and we fixed: the
    // recursion guard checked WILDCARD_EVENT instead of the original
    // event, so a `*` listener throwing while processing `'error'`
    // looped forever. Pinning this so a future "optimisation" can't
    // re-introduce it.
    const app = new Application({ disableGracefulShutdown: true, disableCoreModules: true });
    let calls = 0;
    app.on('*' as any, () => {
      calls++;
      throw new Error('wildcard boom');
    });
    // Should NOT throw / hang. Each emit fires the wildcard once for
    // the named event AND once for the re-emitted Error event = 2 calls.
    expect(() => app.emit(ApplicationEvent.ModuleRegistered, { module: 'x' })).not.toThrow();
    // 1 call for the named event + 1 call for the re-emitted Error.
    // The Error re-emit MUST NOT re-recurse into Error again.
    expect(calls).toBe(2);
  });

  it('a vanilla EnhancedEventEmitter also satisfies IAsyncEventBus — same contract everywhere', () => {
    const bus = new EnhancedEventEmitter();
    const asAsync: IAsyncEventBus = bus;
    expect(typeof asAsync.emitParallel).toBe('function');
    expect(typeof asAsync.emitSerial).toBe('function');
    expect(typeof asAsync.on).toBe('function');
  });
});
