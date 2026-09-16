/**
 * Reading a node health check.
 *
 * Every check the daemon records answers three questions separately — does the
 * box respond, does SSH let you in, does the daemon reply — and each carries
 * its own error string. They are three different problems with three different
 * remedies, so the rules for reading them live here rather than inside a
 * render, where they cannot be tested and tend to be re-derived slightly
 * differently by the next component that needs them.
 */

/** One layer's conclusion. Three answers, never two. */
export type LayerVerdict = 'ok' | 'failed' | 'unmeasured';

/**
 * What one layer concluded.
 *
 * `null` means the layer was not measured, and that is NOT a failure. Two
 * producers fill these in: the health-monitor worker, which opens an SSH
 * session every round, and the daemon's own fallback check, which does not —
 * it pings and probes the Netron port, because a node running omnitron is
 * reached over Netron and SSH is for provisioning it.
 *
 * This console has already made the mistake once. The fallback wrote `false`
 * for SSH, `false` means "refused" to every reader, and the page showed
 * "Waiting for SSH connection" for a node whose SSH works — while never
 * showing `omnitronError`, which held the actual reason. An absence rendered
 * as a failure sends the operator to fix the wrong layer.
 *
 * An error string with no boolean still means failed: something was attempted
 * and it did not work.
 */
export function verdictOf(
  connected: boolean | null | undefined,
  error: string | null | undefined,
): LayerVerdict {
  if (connected == null) return error ? 'failed' : 'unmeasured';
  return connected ? 'ok' : 'failed';
}

/** The three layers of a check, in the order they are attempted. */
export interface CheckLayers {
  pingReachable?: boolean | null;
  pingError?: string | null;
  sshConnected?: boolean | null;
  sshError?: string | null;
  omnitronConnected?: boolean | null;
  omnitronError?: string | null;
}

/**
 * The reason to show for a failed check: the FIRST failing layer.
 *
 * Ordered, not arbitrary. An unreachable host has no SSH answer to give and a
 * refused SSH never reaches the daemon, so a later layer's error is usually a
 * consequence of an earlier one — `connect ECONNREFUSED` under
 * `Host unreachable` explains nothing and points at the wrong fix. Showing the
 * first one names the thing to repair.
 */
export function firstReason(check: CheckLayers): string | null {
  return check.pingError ?? check.sshError ?? check.omnitronError ?? null;
}

/**
 * Whether a check is worth showing as an outage at all.
 *
 * A check that reached nothing measured nothing. It is not evidence that the
 * node was down — the same distinction the uptime bar makes when it reports
 * `-1` for a bucket in which no check could measure omnitron, rather than
 * folding those into the denominator and pulling the figure towards zero.
 */
export function isMeasured(check: CheckLayers): boolean {
  return (
    verdictOf(check.pingReachable, check.pingError) !== 'unmeasured' ||
    verdictOf(check.sshConnected, check.sshError) !== 'unmeasured' ||
    verdictOf(check.omnitronConnected, check.omnitronError) !== 'unmeasured'
  );
}
