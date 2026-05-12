/**
 * Internal collaborator — Application event bus.
 *
 * Wraps `@omnitron-dev/eventemitter` with the two extensions the Application
 * surface depends on: wildcard fan-out (`'*'` listeners receive every event)
 * and a parallel error-handler registry that is invoked on `error`-typed
 * events even when no `on('error')` listener exists.
 *
 * Why a dedicated collaborator? The legacy `Application` class duplicated
 * the same dispatch logic in both `emit` (sync) and `emitAsync` (async)
 * paths, with subtly different error-recursion semantics in each. Folding
 * it here keeps both paths sharing a single dispatch loop, so a fix in
 * one form automatically applies to the other.
 *
 * Single responsibility: synchronous and asynchronous event dispatch with
 * error-isolation between listeners. Owns no app-level state — every
 * argument it needs flows through `emit` / `emitAsync`.
 *
 * @internal
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
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
 * surfaced in `IEventMeta.event`. Matches the contract the legacy
 * implementation exposed.
 */
export const WILDCARD_EVENT = '*' as const;

/**
 * Internal alias for the runtime shape every listener satisfies, even
 * if the underlying emitter typings widen it to `Function`. The
 * EventEmitter we use returns `Function[]` from `listeners()` but every
 * value is callable as `(data, meta) => unknown`.
 */
type EventListener = (data: unknown, meta: IEventMeta) => unknown;

export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly errorHandlers: Array<(error: Error) => void> = [];
  /**
   * The logger is only used for handler-error reporting and is set
   * AFTER the bus is constructed (Application can't supply it at
   * construction time — the logger module hasn't started yet).
   */
  private logger?: ILogger;

  /**
   * Attach the application logger so handler errors get structured
   * reports instead of dropping to `fallbackLog`. Called by Application
   * once the logger module is online.
   */
  setLogger(logger: ILogger | undefined): void {
    this.logger = logger;
  }

  // ─── Registration ────────────────────────────────────────────────────

  on<E extends ApplicationEvent | string>(event: E, handler: EventHandler): void {
    this.emitter.on(event, handler);
  }

  off<E extends ApplicationEvent | string>(event: E, handler?: EventHandler): void {
    if (handler) {
      this.emitter.off(event, handler);
    } else {
      this.emitter.removeAllListeners(event);
    }
  }

  once<E extends ApplicationEvent | string>(event: E, handler: EventHandler): void {
    this.emitter.once(event, handler);
  }

  /**
   * Insert `handler` at the front of the listener list. The underlying
   * emitter lacks a native `prependListener`, so we rewrite the chain.
   */
  prependListener<E extends ApplicationEvent | string>(event: E, handler: EventHandler): void {
    const existing = this.emitter.listeners(event);
    this.emitter.removeAllListeners(event);
    this.emitter.on(event, handler);
    for (const listener of existing) this.emitter.on(event, listener);
  }

  removeAllListeners(event?: ApplicationEvent | string): void {
    if (event) this.emitter.removeAllListeners(event);
    else this.emitter.removeAllListeners();
  }

  listenerCount(event: ApplicationEvent | string): number {
    return this.emitter.listenerCount(event);
  }

  /**
   * Drop EVERY listener AND error handler. Called by Application on
   * teardown so restart cycles don't accumulate stale subscriptions.
   * Without this, every restart cycle doubles handler count for the
   * lifetime of the process.
   */
  clear(): void {
    this.emitter.removeAllListeners();
    this.errorHandlers.length = 0;
  }

  // ─── Error-handler registry ──────────────────────────────────────────

  registerErrorHandler(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  // ─── Dispatch ────────────────────────────────────────────────────────

  emit<E extends ApplicationEvent | string>(event: E, data?: unknown): void {
    const meta = this.makeMeta(event);
    this.runErrorHandlers(event, data, false);

    for (const listener of this.emitter.listeners(event)) {
      this.invokeSync(event, listener as EventListener, data, meta, false);
    }
    if (event !== WILDCARD_EVENT) {
      for (const listener of this.emitter.listeners(WILDCARD_EVENT)) {
        // Wildcard fan-out passes the ORIGINAL `event` for error-event
        // recursion guards: a wildcard listener throwing while processing
        // `'error'` must NOT loop. Passing `WILDCARD_EVENT` would have
        // (and did) infinite-recursed, because '*' is always !== Error.
        this.invokeSync(event, listener as EventListener, data, meta, true);
      }
    }
  }

  async emitAsync<E extends ApplicationEvent | string>(event: E, data?: unknown): Promise<void> {
    const meta = this.makeMeta(event);
    await this.runErrorHandlers(event, data, true);

    try {
      const listeners = this.emitter.listeners(event) as EventListener[];
      await Promise.all(listeners.map((listener) => Promise.resolve(listener(data, meta))));
      if (event !== WILDCARD_EVENT) {
        const wildcards = this.emitter.listeners(WILDCARD_EVENT) as EventListener[];
        await Promise.all(wildcards.map((listener) => Promise.resolve(listener(data, meta))));
      }
    } catch (error) {
      this.logger?.error({ error, event }, 'Error in async event handler');
      if (event !== ApplicationEvent.Error) {
        this.emit(ApplicationEvent.Error, { error });
      }
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  private makeMeta(event: ApplicationEvent | string): IEventMeta {
    return {
      event,
      timestamp: Date.now(),
      source: 'application',
    };
  }

  /**
   * The legacy `Application` treated a literal `'error'` string AND the
   * `ApplicationEvent.Error` enum value as the trigger for the registered
   * error-handler chain. Both string values resolve to `'error'` at
   * runtime — keeping a single check covers both paths.
   *
   * Returns a Promise only when invoked in async mode so callers can
   * `await` it. Sync mode ignores any rejection (handler is then user-
   * synchronous — exceptions surface immediately to invokeSync's catch).
   */
  private runErrorHandlers(
    event: ApplicationEvent | string,
    data: unknown,
    awaitMode: boolean,
  ): Promise<void> | void {
    if (event !== ApplicationEvent.Error && event !== 'error') return;
    if (!(data instanceof Error)) return;
    if (this.errorHandlers.length === 0) return;

    if (!awaitMode) {
      for (const handler of this.errorHandlers) {
        try {
          handler(data);
        } catch (err) {
          this.reportHandlerError(err);
        }
      }
      return;
    }

    return (async () => {
      for (const handler of this.errorHandlers) {
        try {
          await Promise.resolve(handler(data));
        } catch (err) {
          this.reportHandlerError(err);
        }
      }
    })();
  }

  /**
   * Wrap a single listener invocation so its failure can't poison
   * sibling listeners. Re-emits `Error` (unless we're already in the
   * error path) so global subscribers still see the failure.
   */
  private invokeSync(
    event: ApplicationEvent | string,
    listener: EventListener,
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
      // Re-emit through `Error` so global error subscribers see it. The
      // `event !== Error` check breaks an obvious cycle (Error handler
      // throws while processing Error). The check is against the ORIGINAL
      // event so wildcard listeners processing an `Error` event don't
      // start a new error cycle either.
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
