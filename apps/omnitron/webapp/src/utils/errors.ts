/**
 * RPC / network error classifier.
 *
 * Maps low-level HTTP status codes and network failure signatures to
 * concise, user-facing strings. Never exposes internal codes or stack traces.
 */

/** Return a human-readable message for any RPC / fetch error. */
export function classifyRpcError(err: unknown): string {
  const msg = extractMessage(err);

  // Daemon / proxy unreachable
  if (/502|503|bad gateway|service unavailable/i.test(msg)) {
    return 'Service unavailable — the daemon is not running. Start it with omnitron dev.';
  }

  // Network-level failure (browser couldn't reach the server at all)
  if (
    /failed to fetch|networkerror|network request failed|econnrefused|econnreset|etimedout|load failed/i.test(msg)
  ) {
    return 'Cannot reach the server. Check that the daemon is running and your network is connected.';
  }

  // Wrong credentials
  if (/401|unauthorized|invalid.*credential|invalid.*password|incorrect.*password/i.test(msg)) {
    return 'Invalid username or password.';
  }

  // Rate limiting
  if (/429|too many|rate limit/i.test(msg)) {
    return 'Too many sign-in attempts. Please wait a moment and try again.';
  }

  // Generic server error
  if (/500|internal server error/i.test(msg)) {
    return 'The server encountered an error. Please try again.';
  }

  // Timeout
  if (/timeout|timed out/i.test(msg)) {
    return 'The request timed out. The daemon may be overloaded.';
  }

  // Fallback: show the raw message but strip HTTP status prefix noise
  const cleaned = msg.replace(/^HTTP \d{3}:\s*/i, '').trim();
  return cleaned || 'An unexpected error occurred.';
}

/** Sanitise a returnTo query param — rejects non-relative and malformed paths. */
export function sanitizeReturnTo(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback;
  try {
    const decoded = decodeURIComponent(raw);
    // Must be a relative path (starts with /)
    if (!decoded.startsWith('/')) return fallback;
    // Strip any embedded protocol or host (e.g. //evil.com/...)
    const clean = decoded.replace(/^\/\/+/, '/');
    return clean || fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------

function extractMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return String(e['message'] ?? e['msg'] ?? e['error'] ?? '');
  }
  return String(err);
}
