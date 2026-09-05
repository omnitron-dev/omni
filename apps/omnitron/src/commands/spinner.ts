/**
 * A spinner that knows whether anyone is watching.
 *
 * `@xec-sh/kit`'s spinner animates unconditionally: it repaints its frame
 * with cursor-movement escapes on every tick, whether stdout is a terminal or
 * a pipe. Redirected — into a log, a CI job, `2>&1 | tail`, a script reading
 * the output — those repaints are not overwritten by anything, so they all
 * survive as text. One `omnitron restart` produced several hundred lines of
 * `⠙ Restarting paysys[1G[J` for a command whose actual output is one line.
 *
 * The result is worse than noise: the answer is at the end of a wall of
 * control codes, and a script grepping for it may not find it at all.
 *
 * `--json` already suppresses this, but only for commands that honour the
 * flag, and the failure has nothing to do with JSON — a human tailing a log
 * has the same problem. So the test is the terminal, not the flag.
 */

import { spinner as kitSpinner } from '@xec-sh/kit';

export interface Spinner {
  start(message?: string): void;
  stop(message?: string, code?: number): void;
  message(message?: string): void;
}

/** Emits one line per state change, for when nothing can repaint. */
function quietSpinner(): Spinner {
  return {
    start(message) {
      if (message) process.stdout.write(`${message}\n`);
    },
    stop(message) {
      if (message) process.stdout.write(`${message}\n`);
    },
    message(message) {
      if (message) process.stdout.write(`${message}\n`);
    },
  };
}

/**
 * A spinner for a terminal, a line-printer for anything else.
 *
 * Same three methods either way, so call sites do not branch.
 */
export function spinner(): Spinner {
  return process.stdout.isTTY ? (kitSpinner() as Spinner) : quietSpinner();
}
