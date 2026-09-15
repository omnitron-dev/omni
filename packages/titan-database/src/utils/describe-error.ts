/**
 * What went wrong, in words, when the error itself has none.
 *
 * The commonest database failure there is — the server is not reachable —
 * arrives as an `AggregateError`, because Node resolves `localhost` to both
 * `::1` and `127.0.0.1` and fails on each. That error's `message` is the
 * EMPTY STRING, and `String(err)` is the bare word `AggregateError`; the two
 * `ECONNREFUSED` reasons live in `err.errors`, which nothing read.
 *
 * Measured on the daos stand 2026-09-15: paysys had logged
 *
 *     Service default is unavailable: Connection health check failed:
 *
 * 29 099 times in one file — the connection had failed to establish at
 * startup and every repository access since had said so, without once
 * naming a cause. The operator's next question, "refused, timed out, or
 * rejected?", had no answer anywhere in the tree.
 *
 * So: prefer the message; fall back to the aggregated causes; then to a code
 * (`ECONNREFUSED`, `ETIMEDOUT`, `28P01`), which is the field pg sets when it
 * sets nothing else; then to the constructor name. Never return an empty
 * string — a caller composing `${prefix}: ${describeError(e)}` deserves
 * something after the colon.
 */
export function describeError(error: unknown, depth = 0): string {
  if (error == null) return 'unknown error';

  if (typeof error === 'string') return error.trim() || 'unknown error';

  if (!(error instanceof Error)) {
    const described = String(error).trim();
    return described && described !== '[object Object]' ? described : 'unknown error';
  }

  const message = error.message.trim();
  if (message) {
    const code = codeOf(error);
    // A pg error carries the SQLSTATE that a reader can look up; an `Error`
    // that already says "connect ECONNREFUSED 127.0.0.1:5432" does not need
    // the code repeated.
    return code && !message.includes(code) ? `${message} (${code})` : message;
  }

  // `AggregateError` — the empty-message case this exists for. Its causes are
  // usually the same failure per address, so identical ones collapse.
  const causes = (error as { errors?: unknown }).errors;
  if (Array.isArray(causes) && causes.length > 0 && depth < 3) {
    const described = causes.map((c) => describeError(c, depth + 1));
    const unique = [...new Set(described)].filter((d) => d !== 'unknown error');
    if (unique.length > 0) return unique.join('; ');
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause != null && depth < 3) {
    const described = describeError(cause, depth + 1);
    if (described !== 'unknown error') return described;
  }

  const code = codeOf(error);
  if (code) return `${error.name || 'Error'} (${code})`;

  return error.name || 'unknown error';
}

/** `code` as pg and Node set it — a string, and not an empty one. */
function codeOf(error: Error): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.trim() ? code.trim() : undefined;
}
