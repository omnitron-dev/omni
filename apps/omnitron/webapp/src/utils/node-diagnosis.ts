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

import { omnitronFinding } from '@omnitron-dev/omnitron/node-check';

/**
 * One layer's conclusion. `unknown` is the omnitron layer's alone: asked,
 * and no answer could be read — see `omnitronVerdict`.
 */
export type LayerVerdict = 'ok' | 'failed' | 'unknown' | 'unmeasured';

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
 * What the omnitron layer concluded: the same reading as the node's dot and
 * the uptime strip (`omnitronFinding`).
 *
 * `verdictOf` calls an error `failed`, which for this layer reads as «omnitron
 * is down». A timeout, output that was not JSON and an exec that failed are
 * not that, and since 66dae3dc neither is `null` with a reason — no path
 * answered. Those are `unknown`. A refused SSH session looked at nothing
 * (`unmeasured`, the SSH layer says why); a node that said omnitron is not
 * running, or is not installed, did answer (`failed`).
 */
export function omnitronVerdict(check: CheckLayers): LayerVerdict {
  const finding = omnitronFinding({
    sshConnected: check.sshConnected ?? null,
    omnitronConnected: check.omnitronConnected ?? null,
    omnitronError: check.omnitronError ?? null,
  });
  switch (finding) {
    case 'running':
      return 'ok';
    case 'not-running':
    case 'not-installed':
      return 'failed';
    case 'unreachable':
      return 'unmeasured';
    case 'unread':
      // Nothing asked and nothing said — a check that did not try this layer.
      return check.omnitronConnected == null && !check.omnitronError ? 'unmeasured' : 'unknown';
    default: {
      const unexpected: never = finding;
      return unexpected;
    }
  }
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
  // An answer nobody could read is not a measurement either.
  const answered = (verdict: LayerVerdict) => verdict === 'ok' || verdict === 'failed';
  return (
    answered(verdictOf(check.pingReachable, check.pingError)) ||
    answered(verdictOf(check.sshConnected, check.sshError)) ||
    answered(omnitronVerdict(check))
  );
}

/** One node's view of the fleet's leadership, as the daemon returns it. */
export interface ClusterView {
  nodeId: string;
  reachable: boolean;
  cluster: Record<string, unknown> | null;
}

export type Disagreement =
  | { kind: 'none' }
  | { kind: 'leaders'; clusterId: string; answered: number; groups: Array<[string, string[]]> }
  | { kind: 'terms'; clusterId: string; answered: number; terms: string[] };

/** Authority failures remain visible even when only one controller answers. */
export function clusterAuthorityProblems(views: readonly ClusterView[]): Array<{ nodeId: string; reason: string }> {
  return views.flatMap(view => {
    const state = view.cluster;
    if (!view.reachable || !state || state.coordination !== 'postgres-lease') return [];
    if (!['unavailable', 'expired', 'stopped'].includes(String(state.authority))) return [];
    return [{ nodeId: view.nodeId, reason: typeof state.reason === 'string' && state.reason
      ? state.reason : `Cluster authority is ${String(state.authority)}` }];
  });
}

/**
 * Whether the fleet agrees on who leads it.
 *
 * The only reading in this console that is meaningless per node. One node
 * naming a leader is unremarkable; two naming DIFFERENT leaders, or sitting in
 * different epochs, is a disagreement between observations. Samples are not
 * simultaneous and alone do not prove competing authorized writers.
 *
 * Two silences, both deliberate:
 *
 *   - fewer than two answers is `none`. One answer cannot disagree with
 *     anything, and reading "consistent" off a sample of one is how a check
 *     gets believed for the wrong reason.
 *   - a node that could not be asked is not counted. Treating an unreachable
 *     node as one that named nobody would manufacture a disagreement out of
 *     an outage, which is the opposite of the job.
 *
 * Leaders are reported before terms: a term difference during an election is
 * normal and brief, while two live leaders is the thing to act on.
 */
export function clusterDisagreement(views: readonly ClusterView[]): Disagreement {
  const clusters = new Map<string, ClusterView[]>();
  for (const view of views) {
    if (!view.reachable || !view.cluster) continue;
    const id = typeof view.cluster.clusterId === 'string' ? view.cluster.clusterId : 'legacy';
    clusters.set(id, [...(clusters.get(id) ?? []), view]);
  }
  for (const [clusterId, group] of clusters) {
    const result = compareCluster(group, clusterId);
    if (result.kind !== 'none') return result;
  }
  return { kind: 'none' };
}

function compareCluster(answered: readonly ClusterView[], clusterId: string): Disagreement {
  if (answered.length < 2) return { kind: 'none' };

  const leaders = new Map<string, string[]>();
  const terms = new Set<string>();
  for (const v of answered) {
    const leader = typeof v.cluster!.leaderId === 'string' ? v.cluster!.leaderId : '(none)';
    if (!leaders.has(leader)) leaders.set(leader, []);
    leaders.get(leader)!.push(v.nodeId);
    const term = v.cluster!.term;
    if (typeof term === 'string' && /^[1-9][0-9]{0,18}$/.test(term)) terms.add(term);
    else if (typeof term === 'number' && Number.isSafeInteger(term) && term >= 0) terms.add(String(term));
  }

  if (leaders.size > 1) return { kind: 'leaders', clusterId, answered: answered.length, groups: [...leaders] };
  if (terms.size > 1) return { kind: 'terms', clusterId, answered: answered.length, terms: [...terms].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1) };
  return { kind: 'none' };
}
