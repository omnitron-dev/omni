/** Shared, browser-safe readings of release gates, Git provenance and deployment evidence. */

import type { GateOutcome, ReleaseManifest } from '../release/manifest.js';
import type { DeployProgressRecord, ReleaseDeploymentDto } from './dto/services.js';
import type { IProjectInfo, IStackInfo } from './dto/project.js';
import type { RuntimeReleaseEvidence } from '../config/types.js';

/** Retried and concurrent builds can carry a private-directory suffix. */
export function readReleaseId(id: string) {
  const parts = /^(.*)-\d{12}-([0-9a-f]{8})-([0-9a-f]{8})(?:-[A-Za-z0-9]{6})?$/.exec(id);
  return { project: parts?.[1] ?? id, projectCommit: parts?.[2] ?? null, omniCommit: parts?.[3] ?? null };
}

/** Interpret the daemon's start reply consistently for interactive and scripted callers. */
export function readStackStart(stack: Pick<IStackInfo, 'status' | 'apps' | 'notUp'>) {
  const down = stack.apps.filter(app => app.status !== 'online').map(app => `${app.name} (${app.status})`);
  const total = stack.apps.length;
  const online = total - down.length;
  const reported = stack.notUp ?? [];
  const issues = [...new Set([...reported, ...down.filter(app => !reported.some(issue => issue.startsWith(app + ': ')))])];
  if (stack.status !== 'running') issues.push(`stack state: ${stack.status}`);
  const outcome = issues.length === 0 ? 'confirmed' : stack.status === 'error' ? 'failed' : 'partial';
  return { confirmed: outcome === 'confirmed', outcome, online, total, issues } as const;
}

export function deploymentProgressKey(record: Pick<DeployProgressRecord, 'project' | 'stack' | 'node' | 'app'>): string {
  return JSON.stringify([record.project, record.stack, record.node, record.app]);
}

/** Current observations, including imported stack names and earlier controllers with no attribution. */
export function readDeploymentProgress(records: readonly DeployProgressRecord[], project: Pick<IProjectInfo, 'name' | 'configurations'>, stack?: string | null) {
  const transfers: DeployProgressRecord[] = [];
  const unscoped: DeployProgressRecord[] = [];
  for (const record of records) {
    if (!record.project || !record.stack) { unscoped.push(record); continue; }
    const source = project.configurations?.find(item => item.runtimeProject === record.project);
    const publicName = source?.stacks[record.stack] ?? (record.project === project.name ? record.stack : undefined);
    if (publicName && (!stack || publicName === stack)) {
      transfers.push(record.project === project.name && record.stack === publicName
        ? record : { ...record, project: project.name, stack: publicName });
    }
  }
  return { transfers, unscoped };
}

export function releaseTargetLabel(target?: import('../release/target-runtime.js').TargetRuntime): string {
  return target ? `${target.platform}/${target.arch} · Node ${target.node} · ABI ${target.abi}` : 'Target not recorded';
}

export function frameworkSourceLabel(manifest: ReleaseManifest): string {
  const reproduced = manifest.omni.reproduced;
  const packages = reproduced?.packages ?? manifest.omni.registry?.packages;
  const count = packages?.length ?? manifest.builtWith?.packages?.length;
  if (count === undefined) return 'Framework source not recorded';
  return `${reproduced ? 'Reproduced archives' : packages ? 'npm registry' : 'Linked checkout'} · ${count} framework package${count === 1 ? '' : 's'}`;
}

/**
 * The part of a release summary its gates are read from. Not the per-outcome
 * counts beyond `failed`: what did not pass and did not fail is unfinished,
 * whatever a daemon of any age calls it — one that predates `timedOut` and
 * `killed` counted both in `notRun`.
 */
export interface ReleaseGates {
  readonly complete: boolean;
  readonly manifestError?: string;
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
  if (release.manifestError) return { text: 'invalid manifest', tone: 'failed' };
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

/** Finishing the archive step does not imply successful checks or deployment admission. */
export function readBuildChecks(manifest: Pick<ReleaseManifest, 'gates' | 'artifactFailures'>): {
  exitCode: 0 | 1 | 2;
  reason: string | null;
} {
  const incomplete = manifest.gates.filter(gate => gate.status !== 'passed');
  const artifacts = manifest.artifactFailures ?? [];
  const failed = artifacts.length > 0 || incomplete.some(gate => gate.status === 'failed');
  const reasons = [
    ...(manifest.gates.length === 0 ? ['No release checks were recorded'] : []),
    ...incomplete.map(gate => `${gate.name}: ${gate.status}${gate.detail ? ` (${gate.detail})` : ''}`),
    ...artifacts.map(artifact => `${artifact.app}: ${artifact.error}`),
  ];
  return { exitCode: failed ? 1 : reasons.length > 0 ? 2 : 0, reason: reasons.length > 0 ? reasons.join('; ') : null };
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
    label: missing.length ? 'Git: unpublished source' : unknown.length ? 'Git: unverified' : 'Git: publication recorded',
    detail: missing.length
      ? `This release records unpublished source for ${missing.join(' and ')}. Source publication is separate from where applications are deployed or running.`
      : unknown.length ? `Git publication could not be verified for ${unknown.join(' and ')} when this release was built. This does not establish that the source is unpublished.`
        : 'This release records both source commits as published at build time. This saved observation does not check current availability or identify running deployments.',
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
  nodes: Array<{ host: string; port: number; endpoint: string; label: string | null; connected: boolean }>;
  history: StackDeploymentHistory;
  /** Launch provenance is distinct from deployment history and continuous code integrity. */
  runningRelease: 'not-running' | 'confirmed' | 'mixed' | 'modified' | 'unreported';
  releaseEvidence: StackReleaseEvidence;
}

export interface StackReleaseEvidence {
  verified: number;
  total: number;
  releases: Array<{ releaseId: string; manifestSha256: string }>;
  observations: Array<{
    app: string;
    node: string | null;
    pid: number | null;
    generation?: string;
    state: 'confirmed' | 'unreported' | 'modified' | 'unavailable';
    releaseId?: string;
    /** Original producer remains releaseId; this is the separately verified installed selection. */
    consumer?: { releaseId: string; manifestSha256: string; app: string };
    reason?: string;
    observedAt?: string;
    launchId?: string;
  }>;
}

/** Read every physical replica; a healthy peer cannot attest for an unreachable one. */
export function readStackRelease(stack: IStackInfo): Pick<ReleaseStackObservation, 'runningRelease' | 'releaseEvidence'> {
  const observations: StackReleaseEvidence['observations'] = [];
  const releases = new Map<string, StackReleaseEvidence['releases'][number]>();
  const producerManifests = new Map<string, Set<string>>();
  const inspect = (app: { name: string; status: string; pid?: number | null; generation?: string; release?: RuntimeReleaseEvidence }, node: string | null, available = true) => {
    if (available && app.status === 'stopped') return;
    const base = { app: app.name, node, pid: app.pid ?? null,
      ...(typeof app.generation === 'string' && { generation: app.generation }) };
    if (!available || app.status === 'unknown') {
      observations.push({ ...base, state: 'unavailable', reason: 'Application inventory unavailable; launch identity is unknown' });
      return;
    }
    const evidence = app.release;
    // Threads, pools and worker-only topologies need not have one main PID.
    // Bind the receipt to the owner's existing application generation instead.
    // A conflicting/malformed generation never falls back to a surviving PID.
    const hasGeneration = app.generation !== undefined;
    const validGeneration = typeof app.generation === 'string' && app.generation.length > 0 &&
      evidence?.state === 'confirmed' && app.generation === evidence.launchId;
    const validPid = Number.isSafeInteger(app.pid) && app.pid! > 0;
    const validIdentity = hasGeneration ? validGeneration && (app.pid == null || validPid) : validPid;
    const consumer = evidence?.state === 'confirmed' ? evidence.consumer : undefined;
    const validConsumer = consumer === undefined || (consumer && typeof consumer === 'object' && !Array.isArray(consumer) &&
      Object.keys(consumer).sort().join(',') === 'app,manifestSha256,releaseId' &&
      typeof consumer.releaseId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(consumer.releaseId) && !consumer.releaseId.includes('..') &&
      /^[a-f0-9]{64}$/.test(consumer.manifestSha256) && consumer.app === app.name.split('/').at(-1));
    if (evidence?.state === 'confirmed' && app.status === 'online' && validIdentity &&
      evidence.basis === 'verified-launch' && typeof evidence.releaseId === 'string' && evidence.releaseId.length > 0 &&
      /^[a-f0-9]{64}$/.test(evidence.manifestSha256) && /^[a-f0-9]{64}$/.test(evidence.artifactSha256) &&
      typeof evidence.launchId === 'string' && evidence.launchId.length > 0 && Number.isFinite(Date.parse(evidence.observedAt)) && validConsumer) {
      observations.push({ ...base, state: 'confirmed', releaseId: evidence.releaseId, observedAt: evidence.observedAt, launchId: evidence.launchId,
        ...(consumer && { consumer: { ...consumer } }) });
      const selected = consumer ?? evidence;
      releases.set(`${selected.releaseId}:${selected.manifestSha256}`, { releaseId: selected.releaseId, manifestSha256: selected.manifestSha256 });
      const producer = producerManifests.get(evidence.releaseId) ?? new Set<string>();
      producer.add(evidence.manifestSha256); producerManifests.set(evidence.releaseId, producer);
    } else if (evidence?.state === 'modified') {
      observations.push({ ...base, state: 'modified', ...(evidence.releaseId && { releaseId: evidence.releaseId }), reason: evidence.reason });
    } else {
      observations.push({ ...base, state: 'unreported', reason: app.status !== 'online'
        ? `Application is ${app.status}; no active launch is confirmed`
        : evidence?.state === 'confirmed' && hasGeneration && !validGeneration ? 'Application generation is invalid or differs from its launch receipt; request a fresh owner observation'
        : evidence?.state === 'confirmed' && !validIdentity ? 'Application is online but its process identity is unavailable; the launch receipt cannot be bound to this instance'
        : !validConsumer ? 'Runtime launch consumer does not match this application or has invalid identity'
        : evidence?.state === 'unreported' ? evidence.reason : evidence ? 'Runtime launch evidence is incomplete or invalid' : 'Runtime does not report a verified launch receipt' });
    }
  };
  if (stack.type !== 'local' && stack.placements?.length) {
    for (const node of stack.placements) {
      for (const app of node.apps) inspect(app.process ?? { name: app.name, status: node.appsObserved ? 'stopped' : 'unknown' }, node.nodeKey, node.appsObserved);
      if (!node.appsObserved && node.apps.length === 0) inspect({ name: 'inventory', status: 'unknown' }, node.nodeKey, false);
    }
  } else {
    for (const app of stack.apps) inspect(app, null);
    if (stack.type !== 'local') {
      for (const node of stack.nodes.filter(peer => !peer.connected)) inspect({ name: 'inventory', status: 'unknown' }, `${node.host}:${node.port}`, false);
    }
  }
  const releaseEvidence: StackReleaseEvidence = { verified: observations.filter(row => row.state === 'confirmed').length,
    total: observations.length, releases: [...releases.values()], observations };
  const conflictingManifests = new Set(releaseEvidence.releases.map(row => row.releaseId)).size !== releases.size ||
    [...producerManifests.values()].some(manifests => manifests.size > 1);
  const runningRelease = observations.length === 0 && stack.status === 'stopped' ? 'not-running'
    : conflictingManifests || observations.some(row => row.state === 'modified') ? 'modified'
      : observations.length === 0 || observations.some(row => row.state !== 'confirmed') ? 'unreported'
        : releases.size > 1 ? 'mixed' : 'confirmed';
  return { runningRelease, releaseEvidence };
}

/** Shared wording for human CLI output and Console. */
export function runningReleaseLabel(row: Pick<ReleaseStackObservation, 'runningRelease' | 'releaseEvidence'>): string {
  switch (row.runningRelease) {
    case 'not-running': return 'No applications running';
    case 'confirmed': return 'Launch release verified';
    case 'mixed': return 'Different releases are running';
    case 'modified': return 'Runtime differs from its release evidence';
    default: return 'Current release not reported';
  }
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
      nodes: stack.nodes.map(({ host, port, label, connected }) => ({ host, port, label, connected,
        endpoint: `${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`,
      })),
      history: stackDeploymentHistory(project, stack, history),
      ...readStackRelease(stack),
    })) : [],
  };
}
