/**
 * Internal collaborator — Application event bus (T#72).
 *
 * Thin subclass of `EnhancedEventEmitter` from `@omnitron-dev/eventemitter`.
 *
 * ## Why a subclass and not a wrapper
 *
 * The previous incarnation of this file was a 245-line WRAPPER that
 * reimplemented wildcard fan-out (`'*'` listeners receive every event),
 * synchronous + parallel dispatch, listener-error isolation, and a
 * recursion guard for `'error'` events. Every one of those concerns is
 * already implemented — and tested — inside `EnhancedEventEmitter`. The
 * wrapper was the third of three independent event systems the audit
 * flagged: same wheel, reinvented for the Application's lifecycle bus.
 *
 * The T#72 collapse routes the Application's lifecycle events through
 * the SAME canonical primitive that powers Netron, transports, and the
 * standalone `@omnitron-dev/titan-events` service. Now a consumer who
 * understands one `IEventBus` understands all three. The wrapper class
 * survives ONLY to add three small Application-specific extensions
 * that don't belong in the generic primitive:
 *
 *   1. An error-handler **chain** invoked on every `'error'`-typed event,
 *      regardless of whether a normal `on('error')` listener exists.
 *      This is a legacy contract — `Application.onError(fn)` registers
 *      a handler that fires on `Error` events even without a normal
 *      listener registration.
 *   2. `IEventMeta` (`{event, timestamp, source}`) passed as the second
 *      arg to every listener, instead of `EventMetadata` (which has the
 *      same fields but a different key name for `event`).
 *   3. A logger attachment point set after the logger module has booted.
 *
 * @internal
 */

import {
  EnhancedEventEmitter,
  type IAsyncEventBus,
} from '@omnitron-dev/eventemitter';
import { fallbackLog } from '../../utils/fallback-log.js';
import {
  ApplicationEvent,
  type EventHandler,
  type IEventMeta,
} from '../../types.js';
import type { ILogger } from '../../modules/logger/index.js';

/**
 * Wildcard event name. Listeners registered against this name receive
 * every event emitted through the bus, with the original event name
 * surfaced in `IEventMeta.event`. EnhancedEventEmitter's wildcard
 * matcher treats `'*'` as a single-segment match — and since every
 * `ApplicationEvent` value is a flat name (no `.` delimiter), this
 * correctly catches everything.
 */
export const WILDCARD_EVENT = '*' as const;

/**
 * Application event bus — subclass of `EnhancedEventEmitter` with the
 * three Application-specific extensions documented above.
 *
 * The class implements `IAsyncEventBus` (from `@omnitron-dev/eventemitter`)
 * — the canonical interface every event-bus implementation in the
 * framework satisfies. This is the contract that unifies the three
 * historical event systems.
 */
export class EventBus extends EnhancedEventEmitter implements IAsyncEventBus {
  /**
   * Renamed from `errorHandlers` to avoid a collision with
   * EnhancedEventEmitter's own private `errorHandlers` Map (used by its
   * `handleError` machinery). Same semantics, just a non-colliding name.
   */
  private readonly appErrorHandlers: Array<(error: Error) => void> = [];
  private logger?: ILogger;

  constructor() {
    // Wildcards on by default — `'*'` is the single-segment match and
    // every legacy ApplicationEvent name is a single segment, so this
    // gives "subscribe to everything" semantics for free.
    super({ wildcard: true, delimiter: '.' });
  }

  /**
   * Attach the application logger so handler errors get structured
   * reports instead of dropping to `fallbackLog`. Called by Application
   * once the logger module is online.
   */
  setLogger(logger: ILogger | undefined): void {
    this.logger = logger;
  }

  /**
   * Convenience overload that types the handler as the legacy
   * `EventHandler`. EnhancedEventEmitter's `on()` accepts any function
   * — this just narrows the type for callers using ApplicationEvent.
   */
  override on(event: string | symbol, listener: EventHandler | ((...args: any[]) => any)): this {
    return super.on(event, listener as (...args: any[]) => any);
  }

  /**
   * EnhancedEventEmitter has no native `prependListener`. Synthesise it
   * by rewriting the chain. Used by Application.prependListener.
   */
  prependListener(event: string | symbol, listener: EventHandler): this {
    const existing = this.listeners(event);
    this.removeAllListeners(event);
    super.on(event, listener as (...args: any[]) => any);
    for (const l of existing) super.on(event, l as (...args: any[]) => any);
    return this;
  }

  /**
   * Drop EVERY listener AND error handler. Called by Application on
   * teardown so restart cycles don't accumulate stale subscriptions.
   * Without this, every restart cycle doubles handler count for the
   * lifetime of the process.
   */
  clear(): void {
    this.removeAllListeners();
    this.appErrorHandlers.length = 0;
  }

  // ─── Error-handler registry ──────────────────────────────────────────

  registerErrorHandler(handler: (error: Error) => void): void {
    this.appErrorHandlers.push(handler);
  }

  // ─── Dispatch ────────────────────────────────────────────────────────

  /**
   * Synchronous emit. Constructs `IEventMeta`, runs the error-handler
   * chain (if applicable), then delegates to EnhancedEventEmitter's
   * `emitEnhanced` which handles wildcards, interceptors, history, and
   * metrics in one place.
   *
   * Re-emits handler exceptions through `Error` (unless we're already
   * in the error path) so global error subscribers see them. The
   * recursion guard checks the ORIGINAL event because wildcard fan-out
   * runs listeners with the inbound event in metadata — not `'*'` —
   * which keeps the legacy contract intact.
   */
  override emit(event: string | symbol, ...args: any[]): boolean {
    const eventStr = typeof event === 'symbol' ? event.description ?? String(event) : event;
    const data = args[0];
    this.runErrorHandlersSync(eventStr, data);

    const meta: IEventMeta = {
      event: eventStr,
      timestamp: Date.now(),
      source: 'application',
    };
    return this.dispatchSync(eventStr, data, meta);
  }

  /**
   * Async emit. Awaits every direct listener in parallel, then every
   * wildcard listener in parallel. Listener exceptions are caught,
   * logged, and (unless we're processing an `'error'` event) re-emitted
   * via `emit(Error, ...)` so synchronous error subscribers still see
   * the failure.
   */
  async emitAsync(event: string | symbol, ...args: any[]): Promise<void> {
    const eventStr = typeof event === 'symbol' ? event.description ?? String(event) : event;
    const data = args[0];
    await this.runErrorHandlersAsync(eventStr, data);

    const meta: IEventMeta = {
      event: eventStr,
      timestamp: Date.now(),
      source: 'application',
    };

    try {
      const listeners = this.listeners(eventStr);
      await Promise.all(listeners.map((l) => Promise.resolve((l as Function)(data, meta))));
      if (eventStr !== WILDCARD_EVENT) {
        const wildcards = this.listeners(WILDCARD_EVENT);
        await Promise.all(wildcards.map((l) => Promise.resolve((l as Function)(data, meta))));
      }
    } catch (error) {
      this.logger?.error({ error, event: eventStr }, 'Error in async event handler');
      if (eventStr !== ApplicationEvent.Error && eventStr !== 'error') {
        this.emit(ApplicationEvent.Error, { error });
      }
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  /**
   * Sync dispatch loop. Hand-rolled rather than delegating to
   * `super.emitEnhanced` because EnhancedEventEmitter's enhanced path
   * carries optional interceptors / schemas / batching / metrics that
   * Application doesn't use, and routing through them would risk
   * surprising semantic changes between the two emit modes
   * (`'foo'` may behave differently in `emit` vs `emitAsync`).
   *
   * The structure is intentionally identical to `emitAsync` so the
   * sync and async paths stay in lock-step: a fix in one is trivial to
   * apply to the other.
   */
  private dispatchSync(event: string, data: unknown, meta: IEventMeta): boolean {
    let handled = false;
    for (const listener of this.listeners(event)) {
      this.invokeSync(event, listener as Function, data, meta, false);
      handled = true;
    }
    if (event !== WILDCARD_EVENT) {
      for (const listener of this.listeners(WILDCARD_EVENT)) {
        this.invokeSync(event, listener as Function, data, meta, true);
        handled = true;
      }
    }
    return handled;
  }

  /**
   * Sync error-handler chain. Runs every registered handler against an
   * `Error` payload, swallowing per-handler exceptions so one bad
   * handler can't stop the chain.
   */
  private runErrorHandlersSync(event: string, data: unknown): void {
    if (event !== ApplicationEvent.Error && event !== 'error') return;
    if (!(data instanceof Error)) return;
    for (const handler of this.appErrorHandlers) {
      try {
        handler(data);
      } catch (err) {
        this.reportHandlerError(err);
      }
    }
  }

  /**
   * Async error-handler chain. Mirrors the sync version with `await`s so
   * handlers can be async. Same per-handler error isolation.
   */
  private async runErrorHandlersAsync(event: string, data: unknown): Promise<void> {
    if (event !== ApplicationEvent.Error && event !== 'error') return;
    if (!(data instanceof Error)) return;
    for (const handler of this.appErrorHandlers) {
      try {
        await Promise.resolve(handler(data));
      } catch (err) {
        this.reportHandlerError(err);
      }
    }
  }

  /**
   * Wrap a single listener invocation so its failure can't poison
   * sibling listeners. Re-emits `Error` (unless we're already in the
   * error path) so global error subscribers still see the failure.
   *
   * `isWildcardFanout` only affects log message text — the recursion
   * guard checks the ORIGINAL `event` regardless, so a wildcard handler
   * throwing while processing `'error'` does NOT start a new error cycle.
   */
  private invokeSync(
    event: string,
    listener: Function,
    data: unknown,
    meta: IEventMeta,
    isWildcardFanout: boolean,
  ): void {
    try {
      listener(data, meta);
    } catch (handlerError) {
      this.logger?.error(
        { error: handlerError, event },
        isWildcardFanout ? 'Error in wildcard handler' : 'Error in event handler',
      );
      if (event !== ApplicationEvent.Error && event !== 'error') {
        this.emit(ApplicationEvent.Error, handlerError);
      }
    }
  }

  private reportHandlerError(err: unknown): void {
    if (this.logger) this.logger.error({ err }, 'Error in error handler');
    else fallbackLog('error', 'Error in error handler', { err });
  }
}
