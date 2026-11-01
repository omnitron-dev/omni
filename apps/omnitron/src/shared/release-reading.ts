/** Shared, browser-safe readings of release gates, Git provenance and deployment evidence. */

import type { GateOutcome } from '../release/manifest.js';
import type { ReleaseDeploymentDto } from './dto/services.js';
import type { IStackInfo } from './dto/project.js';

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
// Recorded deployments
// ---------------------------------------------------------------------------

/**
 * The latest recorded deployment per stack, not an observation of its processes.
 * An unavailable audit trail is distinct from an empty history.
 */
export type DeploymentsAnswer =
  | { readonly known: true; readonly deployments: readonly ReleaseDeploymentDto[] }
  | { readonly known: false; readonly why: string };

/** Missing deployment history does not imply an unused release. */
export const NO_AUDIT_TRAIL =
  'the daemon cannot read the deployment audit history; current execution is a separate observation';

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
 * Why audit-based retention cannot identify its protected releases. A null
 * result only establishes readable history, not current process provenance.
 */
export function pruneBlindness(answer: DeploymentsAnswer): string | null {
  if (!answer.known) return answer.why;
  const unnamed = unnamedStacks(answer.deployments);
  return unnamed.length > 0 ? `${unnamed.join(', ')} last took a release whose name the trail did not record` : null;
}

/** Git provenance captured by the build, never an execution location. */
export function readSourcePublication(onRemote: { project: boolean | null; omni: boolean | null }, project: string) {
  const missing = [onRemote.project === false ? project : null, onRemote.omni === false ? 'omni' : null].filter(Boolean);
  const unknown = [onRemote.project == null ? project : null, onRemote.omni == null ? 'omni' : null].filter(Boolean);
  return {
    state: missing.length ? 'missing' as const : unknown.length ? 'unknown' as const : 'recorded' as const,
    label: missing.length ? 'Git: no remote branch' : unknown.length ? 'Git: not checked' : 'Git: remote branch recorded',
    detail: missing.length
      ? `At build time, no remote-tracking branch contained the ${missing.join(' and ')} commit. This is a Git snapshot, not a deployment location or a live remote check.`
      : unknown.length ? `Git publication was not verified for ${unknown.join(' and ')} when this release was built.`
        : 'Both commits were present in remote-tracking branches at build time. Current remote availability is not checked here.',
  };
}

export type StackDeploymentHistory =
  | { known: true; last: ReleaseDeploymentDto | null }
  | { known: false; why: string };

/** Resolve retained runtime namespaces without creating another project model. */
export function stackDeploymentHistory(project: string, stack: Pick<IStackInfo, 'name' | 'runtimeScope'>, answer: DeploymentsAnswer): StackDeploymentHistory {
  if (!answer.known) return answer;
  const scope = stack.runtimeScope ?? { project, stack: stack.name };
  const rows = answer.deployments.filter(row =>
    (row.project === project && row.stack === stack.name) || (row.project === scope.project && row.stack === scope.stack));
  if (rows.length === 0) return { known: true, last: null };
  if (rows.some(row => !Number.isFinite(Date.parse(row.at)))) return { known: false, why: 'Deployment history contains an invalid timestamp' };
  const latestAt = Math.max(...rows.map(row => Date.parse(row.at)));
  const latest = rows.filter(row => Date.parse(row.at) === latestAt);
  if (new Set(latest.map(row => JSON.stringify([row.release, row.releaseUnnamed, row.projectCommit, row.omniCommit]))).size > 1) {
    return { known: false, why: 'Conflicting deployment records have the same timestamp' };
  }
  return { known: true, last: latest[0]! };
}

export interface ReleaseStackObservation {
  project: string;
  stack: string;
  type: IStackInfo['type'];
  status: IStackInfo['status'];
  apps: { online: number; total: number; unknown: number };
  nodes: Array<{ host: string; port: number; label: string | null; connected: boolean }>;
  history: StackDeploymentHistory;
  /** Current process DTOs do not attest release identity. Audit history cannot fill that gap. */
  runningRelease: 'not-running' | 'unreported';
}

export interface ReleaseDeploymentState {
  project: string;
  observedAt: string;
  inventory: { known: true } | { known: false; why: string };
  history: DeploymentsAnswer;
  stacks: ReleaseStackObservation[];
}

/** One read model used by CLI, Console and callers of the public package. No mutations. */
export async function readReleaseDeploymentState(project: string, ports: {
  stacks(): Promise<IStackInfo[]>;
  deployments(): Promise<DeploymentsAnswer>;
}): Promise<ReleaseDeploymentState> {
  const [inventory, trail] = await Promise.allSettled([ports.stacks(), ports.deployments()]);
  const rawHistory: DeploymentsAnswer = trail.status === 'fulfilled' ? trail.value
    : { known: false, why: 'Deployment history could not be read' };
  const scopes = inventory.status === 'fulfilled' ? inventory.value.flatMap(stack => stack.runtimeScope ? [stack.runtimeScope] : []) : [];
  const history: DeploymentsAnswer = rawHistory.known ? { known: true, deployments: rawHistory.deployments.filter(row =>
    row.project === project || scopes.some(scope => row.project === scope.project && row.stack === scope.stack)) } : rawHistory;
  return {
    project, observedAt: new Date().toISOString(), history,
    inventory: inventory.status === 'fulfilled' ? { known: true } : { known: false, why: 'Stack inventory could not be read; execution state is unknown' },
    stacks: inventory.status === 'fulfilled' ? inventory.value.map(stack => ({
      project, stack: stack.name, type: stack.type, status: stack.status,
      apps: { online: stack.apps.filter(app => app.status === 'online').length, total: stack.apps.length,
        unknown: stack.apps.filter(app => app.status === 'unknown').length },
      nodes: stack.nodes.map(({ host, port, label, connected }) => ({ host, port, label, connected })),
      history: stackDeploymentHistory(project, stack, history),
      runningRelease: stack.status === 'stopped' && stack.apps.every(app => app.status === 'stopped') ? 'not-running' : 'unreported',
    })) : [],
  };
}
