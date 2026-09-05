/**
 * Assertion helpers for tests that have to wait.
 *
 * Two shapes keep going wrong in this suite:
 *
 * 1. An `expect` inside a bare `setTimeout` escapes the promise the test
 *    returns. Vitest reports the throw as an uncaught exception, `done()`
 *    never runs, and a one-line assertion failure costs the full test timeout
 *    (120s here) before surfacing under the wrong heading.
 *
 * 2. "Has it happened yet?" asserted at one wall-clock instant is a coin flip
 *    under a loaded parallel run. A 20ms timer checked at 100ms lost that flip
 *    and timed out an entire file.
 *
 * `waitFor` in @omnitron-dev/testing polls a boolean predicate, so its failure
 * is always "condition not met within timeout" — the assertion's own diff is
 * lost. These poll the assertions themselves and rethrow the last real
 * failure, so you get "expected 0 to be 1" and the line it came from.
 */

/** Run assertions once, after a fixed delay, with failures routed to reject(). */
export function after(ms: number, assertions: () => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      try {
        assertions();
        resolve();
      } catch (err) {
        reject(err);
      }
    }, ms);
  });
}

/** Poll until the assertions hold, or rethrow the last failure at the deadline. */
export async function eventually(assertions: () => void, timeoutMs = 5000, stepMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertions();
      return;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      await new Promise((r) => setTimeout(r, stepMs));
    }
  }
}
