/**
 * A child process wired the way a real fork-worker is: the last-resort
 * handlers first, the shutdown owners after, and then a programming error.
 *
 * Mirrors `fork-worker.ts`, where the handlers are installed at module scope
 * and `worker-runtime.js` — which builds the Application and the
 * LifecycleController — is imported afterwards.
 *
 * Prints one word per listener that actually runs, so the test can see which
 * of them Node reached.
 */

import { installLastResortErrorHandlers } from '../../src/last-resort-handlers.js';

const mode = process.argv[2] ?? 'programming-error';

installLastResortErrorHandlers({ forceExitAfterMs: 1_500 });

// Both owners classify first, exactly as the real ones do: ProcessHost
// (`process-host.ts:112`) and LifecycleController (`lifecycle-controller.ts:277`)
// let an operational error pass and shut down only on a programming one.
const isOperational = (err: unknown) => (err as NodeJS.ErrnoException)?.code === 'ECONNREFUSED';

// Stands in for ProcessHost (Application's own handler).
process.on('uncaughtException', (err) => {
  if (isOperational(err)) return;
  process.stdout.write('application-shutdown\n');
});

// Stands in for the LifecycleController that carries __shutdown.
process.on('uncaughtException', (err) => {
  if (isOperational(err)) return;
  process.stdout.write('service-shutdown\n');
  // A real controller exits once its hooks are done.
  setTimeout(() => process.exit(3), 50);
});

if (mode === 'operational-error') {
  // What a database or network blip looks like: the clients recover, and the
  // process must keep working.
  const err: NodeJS.ErrnoException = new Error('connect ECONNREFUSED 127.0.0.1:5432');
  err.code = 'ECONNREFUSED';
  setImmediate(() => {
    throw err;
  });
  setTimeout(() => {
    process.stdout.write('still-running\n');
    process.exit(0);
  }, 300);
} else if (mode === 'owner-hangs') {
  // The owner never finishes: the window must be enforced.
  process.removeAllListeners('uncaughtException');
  installLastResortErrorHandlers({ forceExitAfterMs: 300 });
  process.on('uncaughtException', () => {
    process.stdout.write('owner-started\n');
    setInterval(() => {}, 1_000); // holds the loop open for ever
  });
  setImmediate(() => {
    throw new Error('a programming error');
  });
} else {
  setImmediate(() => {
    throw new Error('a programming error');
  });
}
