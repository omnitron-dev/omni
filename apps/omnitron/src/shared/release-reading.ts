/**
 * How a release reads — its gates, and which stacks run it: one reading for
 * the CLI and the console.
 *
 * They read releases apart, and came apart:
 *
 *   - A build with `--skip-gates` records one outcome, `gates: not-run`, and
 *     as `passed/total` that is «0/1» — what one failed gate reads as too.
 *     The CLI learnt to say «skipped» (70b988a6); the console still drew
 *     «0/1».
 *   - A gate that timed out or was killed counted in `notRun` until 70b988a6
 *     gave each its own count. The console coloured by `failed` and `notRun`
 *     alone, so daos-202609230557, whose one gate that did not pass timed
 *     out, would have read a green «20/21».
 *   - A daemon whose database did not come up runs with no audit trail and
 *     serves `deployments()` as `[]` — the shape of «no stack has taken a
 *     release». The CLI learnt that in 70b988a6 and will not prune on it; the
 *     console read `[]` as it came, protected nothing, and a stack's card
 *     said «No recorded deployment of this stack yet» about a stack it could
 *     not ask about.
 *
 * Imported by the console through `@omnitron-dev/omnitron/release-reading`,
 * so nothing here may need Node.
 */

import type { GateOutcome } from '../release/manifest.js';
import type { ReleaseDeploymentDto } from './dto/services.js';

/**
 * The part of a release summary its gates are read from. Not the per-outcome
 * counts beyond `failed`: what did not pass and did not fail is unfinished,
 * whatever a daemon of any age calls it — one that predates `timedOut` and
 * `killed` counted both in `notRun`.
 */
export interface ReleaseGates {
  readonly complete: boolean;
  readonly gates: { readonly total: number; readonly passed: number; readonly failed: number };
  readonly gateList: readonly GateOutcome[];
}

/**
 * The words, and what they say about deploying it: `passed` all of them,
 * `failed` at least one, `unfinished` none failed and not all passed —
 * skipped, not run, timed out, killed — and `none` nothing to read.
 */
export interface GatesReading {
  readonly text: string;
  readonly tone: 'passed' | 'failed' | 'unfinished' | 'none';
}

/** The single outcome a build records when it ran no gate at all, or null. */
export function noGateRan(gates: readonly GateOutcome[]): GateOutcome | null {
  const only = gates.length === 1 ? gates[0]! : null;
  return only && only.name === 'gates' && only.status === 'not-run' ? only : null;
}

export function readGates(release: ReleaseGates): GatesReading {
  if (!release.complete) return { text: 'no manifest', tone: 'none' };
  const none = noGateRan(release.gateList);
  // The builder records `--skip-gates` only as that outcome's reason, so the
  // reason is what is read; any other — no gates script at the commit, a
  // script that printed nothing — is «not run», which is true of all of them.
  if (none) return { text: /--skip-gates/.test(none.detail ?? '') ? 'skipped' : 'not run', tone: 'unfinished' };
  const { total, passed, failed } = release.gates;
  if (total === 0) return { text: '—', tone: 'none' };
  return { text: `${passed}/${total}`, tone: failed > 0 ? 'failed' : passed < total ? 'unfinished' : 'passed' };
}

// ---------------------------------------------------------------------------
// Which stacks run it
// ---------------------------------------------------------------------------

/**
 * Which release each stack runs, or why that cannot be said. `known: false`
 * is not «nothing is deployed», and nothing may read it as that.
 */
export type DeploymentsAnswer =
  | { readonly known: true; readonly deployments: readonly ReleaseDeploymentDto[] }
  | { readonly known: false; readonly why: string };

/** Why a daemon without its audit trail cannot say which release a stack runs. */
export const NO_AUDIT_TRAIL =
  'the daemon has no audit trail, and its `stack.start` rows are what say which release a stack runs';

/**
 * The daemon's `deployments()` rows as an answer: known only when its audit
 * trail is there to have written them.
 */
export function deploymentsAnswer(trailAvailable: boolean, rows: readonly ReleaseDeploymentDto[]): DeploymentsAnswer {
  return trailAvailable ? { known: true, deployments: rows } : { known: false, why: NO_AUDIT_TRAIL };
}

/** Release id → every stack whose last start took it. */
export function stacksByRelease(deployments: readonly ReleaseDeploymentDto[]): Map<string, ReleaseDeploymentDto[]> {
  const out = new Map<string, ReleaseDeploymentDto[]>();
  for (const d of deployments) {
    if (!d.release) continue;
    out.set(d.release, [...(out.get(d.release) ?? []), d]);
  }
  return out;
}

/**
 * Stacks whose last start recorded a release and not its name (rows from
 * before the trail flattened the field). No release can be marked as theirs,
 * and none can be protected for them.
 */
export function unnamedStacks(deployments: readonly ReleaseDeploymentDto[]): string[] {
  return deployments.filter((d) => d.releaseUnnamed).map((d) => `${d.project}/${d.stack}`);
}

/**
 * Why a prune cannot tell which releases the stacks run, or `null` when it
 * can. A prune that goes ahead regardless may remove the one a stack runs.
 */
export function pruneBlindness(answer: DeploymentsAnswer): string | null {
  if (!answer.known) return answer.why;
  const unnamed = unnamedStacks(answer.deployments);
  return unnamed.length > 0 ? `${unnamed.join(', ')} last took a release whose name the trail did not record` : null;
}
