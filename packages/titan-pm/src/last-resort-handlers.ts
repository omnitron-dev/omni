/**
 * The child process's last-resort error handlers.
 *
 * These are installed at module scope in `fork-worker.ts`, BEFORE
 * `worker-runtime.js` is imported (line 149 against line 195), so they are
 * the first listeners on the process. That order matters more than it looks:
 * Node calls `uncaughtException` listeners in registration order and stops
 * the moment one of them calls `process.exit()`, so a first listener that
 * exits synchronously is the only one that ever runs.
 *
 * Two more owners arrive afterwards, and both exist to end the process
 * properly:
 *
 *   titan/src/application/_internal/process-host.ts:129  → Application's
 *       `onFatalException`, which shuts the application down.
 *   titan/src/lifecycle/lifecycle-controller.ts:293      → the controller
 *       `worker-runtime.ts:696` wires, carrying the `service-wrapper-shutdown`
 *       hook at priority 90, i.e. `serviceWrapper.__shutdown()`.
 *
 * Measured with three listeners and a first one that exits: only the first
 * prints, exit code 1. So on any programming error a worker died with its
 * connections unclosed and its buffers unflushed — the hooks had never run.
 * On the dev stand all 14 kinds of process are forks (the daemon runs under
 * `--import tsx/esm` and passes `execArgv` down, which `process-spawner.ts:950`
 * turns into a child process rather than a thread), so this was every process
 * on the stand.
 *
 * It stayed invisible because the warning that describes the arrangement —
 * «existing process error-handlers detected — verify Application+Lifecycle
 * Controller are not BOTH installed», 322 records, always `(2, 2)` — cannot
 * NOT fire: `Application` always installs through `ProcessHost`, and
 * `worker-runtime` always calls `installSignalHandlers`. A warning that is
 * always true reads as noise.
 *
 * So the handler yields. It still writes the fatal line, but when somebody
 * else is listening it lets them run and enforces the exit only if they do
 * not take their window. Operational errors are unchanged: they return, the
 * client reconnects, and the process keeps working.
 */

import { isOperationalError } from '@omnitron-dev/titan/utils';
import { childShutdownWindowMs } from './shutdown-windows.js';

/**
 * How long the shutdown owners get before the exit is enforced.
 *
 * The same variable `worker-runtime.ts` builds its LifecycleController with,
 * so the two agree on the size of the window by construction.
 */


function describe(err: unknown): Record<string, unknown> {
  return err instanceof Error
    ? { message: err.message, stack: err.stack, type: err.name }
    : { message: String(err) };
}

function emit(level: number, msg: string, err: unknown): void {
  process.stderr.write(
    JSON.stringify({ level, time: new Date().toISOString(), pid: process.pid, msg, err: describe(err) }) + '\n',
  );
}

export interface LastResortOptions {
  /** Window the other listeners get before the exit is enforced. */
  forceExitAfterMs?: number;
}

export function installLastResortErrorHandlers(options: LastResortOptions = {}): void {
  // One reader for this variable, in `shutdown-windows.ts`. It used to be
  // read here with `|| DEFAULT_FORCE_EXIT_MS`, which turned a stated `0` —
  // «stop now» — into five seconds, and fell back to a different number than
  // the other reader did.
  const forceExitAfterMs = options.forceExitAfterMs ?? childShutdownWindowMs(process.env);

  const fatal = (event: 'uncaughtException' | 'unhandledRejection', msg: string, err: unknown): void => {
    emit(60, msg, err);

    // Exiting here would run before every listener registered after this
    // one, and Node would never call them — which is how `__shutdown`
    // stopped running. Hand the window to whoever owns shutdown, and keep
    // the guarantee that the process does end: the timer is unref'd, so it
    // never keeps an otherwise-idle process alive, but it still fires if the
    // owner hangs.
    if (process.listenerCount(event) > 1) {
      const timer = setTimeout(() => {
        emit(60, `No shutdown owner finished within ${forceExitAfterMs}ms — exiting`, err);
        process.exit(1);
      }, forceExitAfterMs);
      timer.unref?.();
      return;
    }

    process.exit(1);
  };

  process.on('uncaughtException', (error) => {
    if (isOperationalError(error)) {
      emit(40, 'Uncaught operational exception in fork-worker — letting client recover', error);
      return;
    }
    fatal('uncaughtException', 'Uncaught exception in fork-worker', error);
  });

  process.on('unhandledRejection', (reason) => {
    if (isOperationalError(reason)) {
      emit(40, 'Unhandled operational rejection in fork-worker — letting client recover', reason);
      return;
    }
    fatal('unhandledRejection', 'Unhandled rejection in fork-worker', reason);
  });
}
