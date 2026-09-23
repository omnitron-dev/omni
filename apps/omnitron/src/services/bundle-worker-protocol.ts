/**
 * How the bundle-build child says why it failed.
 *
 * It printed its error's STACK to stderr, and the daemon reported the last
 * four lines of stderr as the reason — so the reason was the message only
 * while the stack was three frames deep or less. Deeper, the four lines were
 * frames and the words that said what was wrong fell out of the window;
 * shallower, the report still ended in `at buildOwnBundle (/Users/…)`, which
 * is what an operator read in the console on 2026-09-23 beside a refusal
 * that had a perfectly good sentence to say.
 *
 * The child now ends with one JSON line naming the reason, after the stack
 * (which stays for whoever reads the log), and the daemon reports that line.
 */

/** What the child writes last when it fails: its stack, then the reason as JSON. */
export function failureOutput(err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : reason;
  return `${stack}\n${JSON.stringify({ failed: reason })}\n`;
}

/** The reason the child gave, or `null` when its output ended some other way. */
export function failureReason(stderr: string): string | null {
  const last = stderr.trim().split('\n').pop() ?? '';
  try {
    const parsed = JSON.parse(last) as { failed?: unknown };
    return typeof parsed?.failed === 'string' && parsed.failed.length > 0 ? parsed.failed : null;
  } catch {
    return null;
  }
}
