/**
 * Internal collaborator — process-level integration.
 *
 * Owns the lifecycle of OS signal handlers (`SIGTERM`/`SIGINT`/`SIGHUP`),
 * the `uncaughtException` / `unhandledRejection` listeners (with the
 * operational-error circuit breaker), and the `process.exit` exit path.
 *
 * Why a dedicated collaborator? The legacy `Application` mingled three
 * separate concerns: registering listeners on the global `process`,
 * deciding when a thrown error is fatal, and orchestrating the shutdown
 * that those events trigger. Splitting them clarifies that this class
 * owns process-listener LIFECYCLE — the *response* (calling `shutdown`)
 * is injected by the orchestrator.
 *
 * Single responsibility: install/remove process listeners idempotently
 * and forward classified events to the shutdown handler the
 * orchestrator passed in.
 *
 * @internal
 */

import { Errors } from '../../errors/index.js';
import {
  ApplicationEvent,
  ShutdownReason,
  type ProcessSignal,
} from '../../types.js';
import {
  isOperationalError,
  createOperationalErrorRecorder,
} from '../../utils/error-classification.js';
import type { ILogger } from '../../modules/logger/index.js';

/** Signals we hook by default. Kept as a const tuple so the union type matches `ProcessSignal`. */
const PROCESS_SIGNALS: readonly ProcessSignal[] = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;

export interface ProcessHostHooks {
  /** Called when a signal-driven shutdown should begin. */
  onSignal: (signal: ProcessSignal, reason: ShutdownReason) => void;
  /** Called for an uncaught exception that the circuit breaker has tripped on. */
  onFatalException: (error: Error) => void;
  /** Called for a non-fatal (operational) uncaught exception. */
  onRecoverableException: (error: Error) => void;
  /** Called for a fatal unhandled rejection (or non-test environment rejection). */
  onFatalRejection: (reason: unknown, promise: Promise<unknown>) => void;
  /** Called for a non-fatal (operational) unhandled rejection. */
  onRecoverableRejection: (reason: unknown, promise: Promise<unknown>) => void;
  /** Allows the host to broadcast lifecycle events through the orchestrator. */
  emit: (event: ApplicationEvent, data?: unknown) => void;
}

export class ProcessHost {
  /**
   * Listener handle map — keyed by the event name we attached on
   * `process`, value is the listener fn we wired. `cleanup()` removes
   * exactly the listeners we own; we never touch foreign listeners that
   * other code paths added independently.
   */
  private readonly listenerMap = new Map<string, (...args: any[]) => void>();

  /** Set to true once we've installed listeners; protects against double-install. */
  private installed = false;

  /**
   * When true, `exit()` is swallowed (only an event is emitted instead).
   * Set in test environments OR when the consumer opts out. NOT readonly
   * because the legacy `Application._disableProcessExit` field was
   * writable, and a small number of test suites toggle the value at
   * runtime to verify exit-path behaviour.
   */
  disableProcessExit: boolean;

  /**
   * Tests configure this so the host doesn't actually shut down on
   * `unhandledRejection` — many test suites generate test rejections
   * intentionally.
   */
  private readonly shutdownOnRejection: boolean;

  private logger?: ILogger;

  constructor(options: { disableProcessExit: boolean }) {
    this.disableProcessExit = options.disableProcessExit;
    // Production behaviour: rejections trigger shutdown. Tests opt out by
    // setting `disableProcessExit`, mirroring the legacy guard.
    this.shutdownOnRejection = !options.disableProcessExit;
  }

  setLogger(logger: ILogger | undefined): void {
    this.logger = logger;
  }

  /**
   * Register process-level handlers. Idempotent: a second call while
   * handlers are already attached is a no-op. Without that guard each
   * restart cycle would add another listener and Node would emit
   * `MaxListenersExceededWarning` after 10 cycles.
   */
  install(hooks: ProcessHostHooks): void {
    if (this.installed) return;
    this.installed = true;

    for (const signal of PROCESS_SIGNALS) {
      const handler = () => this.dispatchSignal(signal, hooks);
      this.listenerMap.set(signal, handler);
      process.on(signal, handler);
      this.logger?.debug({ signal }, 'Registered signal handler');
    }

    const errorRecorder = createOperationalErrorRecorder();

    const uncaughtHandler = (error: Error) => {
      if (isOperationalError(error)) {
        const tripped = errorRecorder();
        if (!tripped) {
          this.logger?.error({ error }, 'Uncaught operational exception — continuing');
          hooks.emit(ApplicationEvent.UncaughtException, { error, recovered: true });
          hooks.onRecoverableException(error);
          return;
        }
        this.logger?.fatal({ error }, 'Operational error rate exceeded — shutting down');
      } else {
        this.logger?.fatal({ error }, 'Uncaught exception');
      }
      hooks.emit(ApplicationEvent.UncaughtException, { error });
      hooks.onFatalException(error);
    };
    this.listenerMap.set('uncaughtException', uncaughtHandler);
    process.on('uncaughtException', uncaughtHandler);

    const rejectionHandler = (reason: unknown, promise: Promise<unknown>) => {
      if (isOperationalError(reason)) {
        const tripped = errorRecorder();
        if (!tripped) {
          this.logger?.error({ reason }, 'Unhandled operational rejection — continuing');
          hooks.emit(ApplicationEvent.UnhandledRejection, { reason, promise, recovered: true });
          hooks.onRecoverableRejection(reason, promise);
          return;
        }
        this.logger?.fatal({ reason }, 'Operational rejection rate exceeded — shutting down');
      } else {
        this.logger?.error({ reason, promise }, 'Unhandled promise rejection');
      }
      hooks.emit(ApplicationEvent.UnhandledRejection, { reason, promise });
      if (this.shutdownOnRejection) hooks.onFatalRejection(reason, promise);
    };
    this.listenerMap.set('unhandledRejection', rejectionHandler);
    process.on('unhandledRejection', rejectionHandler);
  }

  /**
   * Remove every listener we registered. Safe to call multiple times —
   * the map is emptied so a second call is a no-op.
   *
   * Always pair with `install()` on the corresponding teardown path.
   * The legacy implementation gated cleanup on `!_isShuttingDown` which
   * left listeners attached when shutdown drove the stop; restart cycles
   * then accumulated listeners forever. Removing the gate (and making
   * `install()` idempotent) is the cleaner pairing.
   */
  cleanup(): void {
    if (!this.installed) return;
    for (const [event, handler] of this.listenerMap.entries()) {
      process.removeListener(event, handler);
    }
    this.listenerMap.clear();
    this.installed = false;
  }

  /**
   * Exit the process with the given code. In test mode (or when the
   * consumer explicitly opts out) we skip the actual `process.exit`
   * call so test runners aren't killed; we still emit a `ProcessExit`
   * event so observers can see what would have happened.
   */
  exit(code: number, hooks: Pick<ProcessHostHooks, 'emit'>): void {
    if (this.disableProcessExit) {
      this.logger?.debug(`Process exit with code ${code} (disabled in test mode)`);
      hooks.emit(ApplicationEvent.ProcessExit, { code });
      return;
    }
    process.exit(code);
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private dispatchSignal(signal: ProcessSignal, hooks: ProcessHostHooks): void {
    this.logger?.info({ signal }, `Received ${signal} signal, initiating graceful shutdown...`);
    hooks.emit(ApplicationEvent.Signal, { signal });

    let reason: ShutdownReason;
    switch (signal) {
      case 'SIGTERM': reason = ShutdownReason.SIGTERM; break;
      case 'SIGINT':  reason = ShutdownReason.SIGINT;  break;
      case 'SIGHUP':  reason = ShutdownReason.Reload;  break;
      default:        reason = ShutdownReason.Signal;
    }

    try {
      hooks.onSignal(signal, reason);
    } catch (error) {
      this.logger?.fatal({ error }, 'Failed to handle signal');
      this.exit(1, hooks);
    }
  }
}

/**
 * Format the timeout error used when a hook overruns its deadline.
 * Exposed for hook-runner callers so the message stays consistent.
 */
export function hookTimeoutError(name: string, timeoutMs: number): Error {
  return Errors.timeout(`Start hook "${name || 'unnamed'}" timed out after ${timeoutMs}ms — check for missing await or blocking I/O`, timeoutMs);
}
