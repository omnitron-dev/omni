/**
 * Upgrading the omnitron on a fleet of nodes, one at a time.
 *
 * The mechanics — build a bundle, ship it, install beside the running copy,
 * verify, switch a symlink — are in `bundle-builder.ts` and
 * `remote-deployer.service.ts`. This is the part that decides which nodes,
 * in what order, and when to stop.
 *
 * ## Why one at a time, and why it stops
 *
 * A fleet upgrade that continues past a failure turns one broken node into
 * all of them. The second node fails for the same reason as the first —
 * whatever that reason is, it is almost never specific to a machine — and by
 * the time anybody reads the output there is nothing left serving.
 *
 * So: sequential, and the first failure ends the run. The nodes that were
 * upgraded stay upgraded, the rest stay as they were, and the report says
 * exactly which is which. That is a state an operator can act on; "seven of
 * twelve, and I don't know which seven" is not.
 *
 * ## What it skips, and why that is not the same as succeeding
 *
 * A node already running the target version is skipped. That makes a re-run
 * after a partial upgrade finish the job rather than redo it — and it is why
 * the version has to be one the registry cannot mint: two different builds
 * both calling themselves `0.2.0` would make every node look up to date.
 */

/** What a node reports about itself, for the purposes of upgrading it. */
export interface UpgradeCandidate {
  readonly nodeId: string;
  readonly name: string;
  /** The version it is running now, or null when it could not be asked. */
  readonly currentVersion: string | null;
  /** False for the machine this daemon is: it is upgraded by rebuilding. */
  readonly isLocal: boolean;
  /**
   * Whether SSH worked at the last check — `null` when that check made no
   * SSH attempt.
   *
   * SSH, not the daemon. An upgrade travels over SSH; the fleet port is a
   * different channel, and gating on it refuses precisely the nodes most
   * worth upgrading.
   *
   * Measured 2026-09-15, the first `fleet upgrade --dry-run` against the real
   * fleet: both nodes refused as "did not answer its last health check".
   * Correct about the data and wrong about the question — the node had been
   * up eight hours on a version I had shipped, and was listening on
   * `127.0.0.1:9700` because of a bind defect fixed AFTER that build. So the
   * one machine that needed the new code was the one the rule would not send
   * it to, and the reason was a channel the upgrade does not use.
   */
  readonly sshReachable: boolean | null;
}

export type UpgradeDecision =
  | { readonly action: 'upgrade'; readonly from: string | null }
  | { readonly action: 'skip'; readonly because: string }
  | { readonly action: 'refuse'; readonly because: string };

export interface PlannedUpgrade {
  readonly node: UpgradeCandidate;
  readonly decision: UpgradeDecision;
}

export interface UpgradePlan {
  readonly targetVersion: string;
  readonly steps: readonly PlannedUpgrade[];
  /** Nodes that will actually be touched, in order. */
  readonly toUpgrade: readonly UpgradeCandidate[];
  /** Set when the run should not start at all. */
  readonly refusal?: string;
}

/**
 * Decide what to do with each node.
 *
 * Pure, and separate from the running, because "which nodes and why" is the
 * part an operator needs to see BEFORE anything is shipped. A dry run is this
 * function and nothing else.
 */
export function planUpgrade(
  candidates: readonly UpgradeCandidate[],
  targetVersion: string,
  options: { readonly only?: readonly string[] | undefined } = {},
): UpgradePlan {
  const wanted = options.only && options.only.length > 0 ? new Set(options.only) : null;

  const steps: PlannedUpgrade[] = [];
  for (const node of candidates) {
    if (wanted && !wanted.has(node.name) && !wanted.has(node.nodeId)) {
      continue;
    }
    steps.push({ node, decision: decideFor(node, targetVersion) });
  }

  if (wanted) {
    // A name that matched nothing is a typo, and a typo that silently
    // upgrades a different set of machines than the operator meant is the
    // worst way to find out. Nothing runs.
    const matched = new Set(steps.flatMap((s) => [s.node.name, s.node.nodeId]));
    const unknown = [...wanted].filter((w) => !matched.has(w));
    if (unknown.length > 0) {
      return {
        targetVersion,
        steps: [],
        toUpgrade: [],
        refusal: `No such node: ${unknown.join(', ')}.`,
      };
    }
  }

  return {
    targetVersion,
    steps,
    toUpgrade: steps.filter((s) => s.decision.action === 'upgrade').map((s) => s.node),
  };
}

function decideFor(node: UpgradeCandidate, targetVersion: string): UpgradeDecision {
  if (node.isLocal) {
    // This daemon runs from a build, not from a bundle. Shipping one to
    // itself would install a second copy beside the tree it was built from.
    return { action: 'skip', because: 'this is the local daemon' };
  }
  if (node.currentVersion === targetVersion) {
    return { action: 'skip', because: `already running ${targetVersion}` };
  }
  if (node.sshReachable === false) {
    // Not a refusal of the whole run — one unreachable node should not stop
    // an operator upgrading the rest — but not worth attempting either: the
    // transfer would spend its timeout learning what the last SSH attempt
    // already found.
    //
    // `null` is deliberately not this. It means the last check made no SSH
    // attempt, which is what the daemon's own fallback check does, and
    // "nobody tried" is not "it refused".
    return { action: 'refuse', because: 'SSH was refused at the last check' };
  }
  return { action: 'upgrade', from: node.currentVersion };
}

// =============================================================================
// Running it
// =============================================================================

export interface UpgradeOutcome {
  readonly nodeId: string;
  readonly name: string;
  readonly ok: boolean;
  /** What happened, for the report. */
  readonly detail: string;
}

export interface UpgradeRunner {
  /** Transfer and install beside the running copy. Does not activate. */
  install(node: UpgradeCandidate): Promise<boolean>;
  /** Make it current and restart into it. */
  activate(node: UpgradeCandidate): Promise<boolean>;
}

export interface UpgradeReport {
  readonly upgraded: readonly UpgradeOutcome[];
  readonly skipped: readonly UpgradeOutcome[];
  readonly failed: UpgradeOutcome | null;
  /** Nodes never reached because the run stopped. */
  readonly notAttempted: readonly string[];
}

/**
 * Run a plan, stopping at the first failure.
 *
 * Install and activate are separate calls on purpose: a node whose install
 * fails has changed nothing, and the run can stop having cost only disk.
 */
export async function runUpgrade(plan: UpgradePlan, runner: UpgradeRunner): Promise<UpgradeReport> {
  const upgraded: UpgradeOutcome[] = [];
  const skipped: UpgradeOutcome[] = [];
  let failed: UpgradeOutcome | null = null;

  for (const step of plan.steps) {
    if (step.decision.action !== 'upgrade') {
      skipped.push({
        nodeId: step.node.nodeId,
        name: step.node.name,
        ok: step.decision.action === 'skip',
        detail: step.decision.because,
      });
      continue;
    }

    if (failed) break;

    const installed = await runner.install(step.node);
    if (!installed) {
      failed = {
        nodeId: step.node.nodeId, name: step.node.name, ok: false,
        detail: 'the install failed; this node is unchanged',
      };
      break;
    }

    const activated = await runner.activate(step.node);
    if (!activated) {
      failed = {
        nodeId: step.node.nodeId, name: step.node.name, ok: false,
        detail: `the new version did not come up; the previous one is still installed on this node`,
      };
      break;
    }

    upgraded.push({
      nodeId: step.node.nodeId, name: step.node.name, ok: true,
      detail: `${step.decision.from ?? 'unknown'} → ${plan.targetVersion}`,
    });
  }

  // Everything after the failure, named — so the operator knows the boundary
  // rather than inferring it from a count.
  const attempted = new Set([...upgraded, ...skipped].map((o) => o.nodeId).concat(failed ? [failed.nodeId] : []));
  const notAttempted = plan.steps
    .map((s) => s.node)
    .filter((n) => !attempted.has(n.nodeId))
    .map((n) => n.name);

  return { upgraded, skipped, failed, notAttempted };
}
