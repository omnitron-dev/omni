/**
 * Deciding whether the daemon is down.
 *
 * The console's banner says "Daemon offline — run `omnitron dev` to start the
 * backend", which is an instruction, not an observation: it tells an operator
 * to start something. It was raised by a single failed probe, and one of the
 * ways a probe fails is a five-second timeout — so on a loaded machine, which
 * is when a console is being watched, a daemon that was answering CLI queries
 * in the same second was reported as not running. Observed exactly that.
 *
 * The two failures are not the same thing and this module keeps them apart:
 *
 *   - The proxy answering 502/503 means it reached nginx and nginx could not
 *     reach the daemon. That is evidence of absence.
 *   - A timeout, an aborted fetch, a network error: the request did not
 *     complete. That is absence of evidence, and one of them says nothing.
 *
 * Kept apart from the store so the rule can be tested without a DOM.
 */

/** What a single probe established. */
export type ProbeOutcome =
  /** The daemon answered and said it is up. */
  | 'up'
  /** Something answered for the daemon and said it is not there. */
  | 'down'
  /** Nothing answered in time. Says nothing about the daemon either way. */
  | 'unreachable';

export type BackendStatus = 'unknown' | 'online' | 'offline' | 'degraded';

/**
 * Classify an HTTP response from `/api/health`.
 *
 * @param body parsed JSON body, or null when it was not JSON
 */
export function classifyHealthResponse(
  status: number,
  contentType: string | null,
  body: { status?: string } | null
): ProbeOutcome {
  // The proxy reached, the daemon did not answer it.
  if (status === 502 || status === 503) return 'down';

  // The SPA fallback: the route is not proxied to the daemon at all, so this
  // deployment cannot answer the question. Reporting "offline" here would
  // blame the daemon for a routing mistake.
  if ((contentType ?? '').includes('text/html')) return 'unreachable';

  if (status < 200 || status >= 300) return 'unreachable';
  return body?.status === 'online' ? 'up' : 'down';
}

/**
 * Fold a probe outcome into the status shown to the operator.
 *
 * A single `unreachable` yields `degraded` — the view may be stale, but the
 * operator is not told to start something that is probably running. Only a
 * second consecutive one concludes `offline`.
 *
 * @param outcome what the probe established
 * @param consecutiveUnreachable how many probes in a row had failed BEFORE
 *        this one
 */
export function nextBackendStatus(
  outcome: ProbeOutcome,
  consecutiveUnreachable: number
): { status: BackendStatus; consecutiveUnreachable: number } {
  if (outcome === 'up') return { status: 'online', consecutiveUnreachable: 0 };

  // An explicit "not there" needs no corroboration.
  if (outcome === 'down') return { status: 'offline', consecutiveUnreachable: 0 };

  const failures = consecutiveUnreachable + 1;
  return { status: failures >= 2 ? 'offline' : 'degraded', consecutiveUnreachable: failures };
}
