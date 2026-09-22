/**
 * A child that answers SIGTERM after a stated delay.
 *
 * `argv[2]` is how long its shutdown takes, in milliseconds. Below the window
 * the supervisor grants it, it should exit on its own; above, it should be
 * killed — and the suite asserts exactly that boundary, because a fix that
 * merely widened the window would pass one half and fail the other.
 *
 * It also reports the window it was TOLD it has, so the suite can check the
 * supervisor actually passed one down rather than letting the child guess.
 */
'use strict';

const shutdownMs = Number(process.argv[2] ?? 0);

process.send?.({ type: 'ready', toldWindowMs: process.env.TITAN_SHUTDOWN_TIMEOUT_MS ?? null });

process.on('SIGTERM', () => {
  setTimeout(() => process.exit(0), shutdownMs);
});

// Also honour the IPC shutdown message the supervisor sends first.
process.on('message', (msg) => {
  if (msg && msg.type === 'shutdown') {
    setTimeout(() => process.exit(0), shutdownMs);
  }
});

// Keep the loop alive until one of the above fires.
setInterval(() => {}, 60_000);
