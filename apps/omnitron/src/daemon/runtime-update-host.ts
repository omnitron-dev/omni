import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { inspectRuntimeArtifact, verifyRuntimeArtifact } from '../shared/runtime-artifact.js';
import { BACKEND_ACTIVITY_COUNTERS } from '../shared/dto/backend.js';
import { retainReviewedBackups } from '../shared/backup-admission.js';
import { LAUNCHD_LABEL, OWNER_LAUNCHD_LABEL } from '../commands/service-units.js';
import { localStackInventory } from '../project/local-stack-inventory.js';
import { readRestartConfiguration, saveRestartConfiguration, restartConfigurationDigest, restartIntentDigest, restartLaunchIntent, assertRestartOwnerDefaults, type RuntimeRestartConfiguration } from '../project/runtime-restart.js';
import { privateControlClient } from './private-control-client.js';
import { assertRuntimeUpdateHealth, RuntimeUpdateHealthRegression } from './runtime-update.js';
import { RuntimeObservationPending, RuntimeObservationConflict, RuntimeObservationUnconfirmed,
  observeRuntimeUntil, withRuntimeObservation, type RuntimeObservation } from './runtime-observation.js';
import { CommandResultError } from '../shared/command-result.js';
import type { BackendControlService } from './backend-control.js';
import type { BackendRpcService } from './backend.rpc-service.js';
import type { ExecutionHostService } from './execution-host.js';
import type { BackupRpcService } from '../services/backup.rpc-service.js';
import type { OperationReceipt } from '../shared/dto/execution-operations.js';

import type { ReleaseCommand } from '@xec-sh/ops/release';
import type { ContainerState } from '../infrastructure/types.js';
import type { BuildStamp } from '../shared/build-stamp.js';
import type { ManagedRuntime } from './managed-runtime.js';
import type { RuntimeSelection } from './runtime-installation.js';
import type { StackStartReview, SelectedRelease } from '../shared/dto/project.js';
import type { RuntimeUpdateActions, RuntimeUpdateRestoration } from './runtime-update.js';
import type { RuntimeRestartReview, RuntimeUpdateIdentity, RuntimeUpdateInfrastructure, RuntimeUpdatePlan, RuntimeUpdateProjectObservation, RuntimeUpdateStack, RuntimeUpdateStackObservation, RuntimeUpdateStatusObservation, RuntimeUpdateSelection, ReviewedRuntimeUpdateStack, VerifiedRuntimeReference } from '../shared/dto/runtime-update.js';

export type RuntimeUpdateCall = <T>(argv: readonly string[], runtimeRoot?: string, options?: { timeoutMs?: number; signal?: AbortSignal }) => Promise<T>;
interface ColdStartObservation {
  checked: boolean; candidate: string; schemaScope: 'node' | 'all'; coldStackAdmissionProtocol?: number | null;
  runtimeRestartProtocol?: number | null;
  infrastructure: { coverage: string; intentDigest: string; containers: Array<{ name: string; id: string; action: string }>; controlPlaneDatabase?: { id: string; action: string } };
}

const hash = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const cleanBuild = (stamp: Pick<BuildStamp, 'dirty' | 'commit'> | null | undefined): stamp is Pick<BuildStamp, 'dirty' | 'commit'> => stamp?.dirty === false && commit.test(stamp.commit);
const projectKey = (stack: { project: string; stack: string }) => JSON.stringify([stack.project, stack.stack]);
const cliDist = 'packages/0/dist';
const runtimeInspections = new WeakMap<VerifiedRuntimeReference, Awaited<ReturnType<typeof inspectRuntimeArtifact>>>();

async function runtimeBuildCommit(runtimeRoot: string, console = false): Promise<string> {
  const value = JSON.parse(await fs.readFile(path.join(runtimeRoot, 'packages/0', console ? 'webapp/dist' : 'dist', 'BUILD.json'), 'utf8')) as BuildStamp;
  if (!cleanBuild(value)) throw Error('Cannot use a dirty or unknown installed build: ' + runtimeRoot);
  return value.commit;
}

export async function verifyRuntimeUpdateTarget(runtime: string, expectedHash?: string): Promise<VerifiedRuntimeReference> {
  const directory = await fs.realpath(runtime);
  const inspection = await inspectRuntimeArtifact(directory, expectedHash), { manifest } = inspection;
  const sourceCommit = await runtimeBuildCommit(directory);
  if (await runtimeBuildCommit(directory, true) !== sourceCommit) throw Error('Runtime and Console have different source revisions');
  const node = path.join(directory, 'node');
  const cli = path.join(directory, cliDist, 'cli/omnitron.js');
  if (await fs.realpath(node) !== node || await fs.realpath(cli) !== cli) throw Error('Native runtime entry points must be regular files at their sealed locations');
  await inspection.assertUnchanged();
  const reference = Object.freeze({ artifact: manifest.sha256, commit: sourceCommit, directory, node, cli,
    nodeVersion: manifest.nodeVersion, platform: manifest.platform, arch: manifest.arch });
  runtimeInspections.set(reference, inspection);
  return reference;
}

/** A serialized reference describes a target; only this process's live proof can admit it. */
async function inspectedRuntime(reference: VerifiedRuntimeReference) {
  const inspection = runtimeInspections.get(reference);
  if (!inspection) throw Error('Runtime target has no in-process verification');
  await inspection.assertUnchanged();
  return inspection.manifest;
}

async function until<T>(label: string, body: () => Promise<T>, budget: number): Promise<T> {
  const deadline = performance.now() + budget;
  for (;;) {
    try { return await body(); } catch (cause) {
      if (performance.now() >= deadline) throw Error(label + ': ' + (cause instanceof Error ? cause.message : String(cause)), { cause });
    }
    await delay(2000);
  }
}

/** A review may observe an owned backup; it never certifies shutdown admission. */
export function assertLocalReview(status: RuntimeUpdateStatusObservation) {
  const execution = status?.execution;
  if (execution?.mode !== 'resident' || execution.phase !== 'active' || execution.connection?.status !== 'connected' ||
      execution.supervision?.type !== 'independent' || !execution.owner?.id || !Number.isSafeInteger(execution.epoch))
    throw Error('Local admission requires a connected, independently supervised execution owner');
  const counters = execution.blockers;
  if (!counters || ![...BACKEND_ACTIVITY_COUNTERS, 'backupOperations'].every(name => Object.hasOwn(counters, name)) ||
      Object.values(counters).some(n => !Number.isSafeInteger(n) || n < 0)) throw Error('Incomplete backend activity counters');
  const busy = Object.entries(counters).filter(([name, n]) => n > 0 && name !== 'backupOperations');
  if (busy.length) throw Error('Local update deferred while work is active: ' + busy.map(([name, n]) => `${name}=${n}`).join(', '));
}

export function assertLocalIdle(status: RuntimeUpdateStatusObservation) {
  assertLocalReview(status);
  const execution = status.execution!;
  const backups = execution.blockers.backupOperations!;
  if (backups > 0) throw Error('Local update deferred while work is active: backupOperations=' + backups);
  if (execution.recovery?.status !== 'ready') throw Error(execution.recovery?.reason || 'Waiting for the current recovery certificate');
}

// The controller which restores both directions must admit the exact review.
export function assertReviewedBoot(stack: RuntimeUpdateStack, digest: string, protocol: 1 | undefined) {
  const preserved = stack.infrastructureMode === 'preserve' && stack.infrastructureReview === digest;
  const once = protocol === 1 && stack.infrastructureMode === 'reconcile' && stack.infrastructureReview === null;
  if (!stack.enabled || !hash.test(digest) || (!preserved && !once)) {
    const reason = !stack.enabled ? 'The saved stack is disabled.' : !hash.test(digest) ? 'The infrastructure review digest is invalid.' :
      'The restoring controller must support coldStackAdmissionProtocol@1, or the saved stack must already preserve this exact infrastructure review.';
    throw Error('Local restart cannot prove reviewed boot for ' + stack.project + '/' + stack.stack + '. ' + reason);
  }
}

export function assertSameSavedSelection(prior: ReviewedRuntimeUpdateStack, now: RuntimeUpdateStack) {
  if (!prior.savedSelection) throw Error('The local update plan has no saved launch selection for ' + projectKey(prior));
  if (!isDeepStrictEqual(prior.savedSelection, now.selection)) throw new RuntimeObservationConflict('Saved launch selection changed for ' + projectKey(prior));
}

export function assertLocalServiceTargets(config: ManagedRuntime | null): asserts config is ManagedRuntime {
  if (config?.scope !== 'user' || config.owner.label !== OWNER_LAUNCHD_LABEL || config.backend.label !== LAUNCHD_LABEL)
    throw Error('Local service commands address only the standard Omnitron user services');
}

/** Stopped stacks can disappear from boot declarations while their containers remain retained. */
export function assertRetainedRuntimeInfrastructure(expected: RuntimeUpdateInfrastructure, boot: RuntimeUpdateInfrastructure,
  observed: readonly Pick<ContainerState, 'name' | 'containerId'>[]): void {
  if (boot.database !== expected.database) throw new RuntimeObservationConflict('The control-plane database identity changed');
  const reviewed = new Map(expected.containers.map(container => [container.name, container.id]));
  const native = new Map(observed.map(container => [container.name, container.containerId]));
  if (reviewed.size !== expected.containers.length || native.size !== observed.length)
    throw Error('Container identity observation contains duplicate names');
  for (const [name, id] of reviewed)
    if (native.get(name) !== id) throw new RuntimeObservationConflict('Retained native container identity changed: ' + name);
  for (const container of boot.containers)
    if (reviewed.get(container.name) !== container.id) throw new RuntimeObservationConflict('Unreviewed container in boot declarations: ' + container.name);
}

/** Complete a restored owner through the existing warm role handoffs. Repeating
 * this after a lost reply observes committed roles; it never starts an owner. */
export async function restoreRuntimeRoles(plan: RuntimeUpdatePlan, observe: () => Promise<RuntimeUpdateIdentity>,
  accept: () => Promise<unknown>, call: RuntimeUpdateCall, restoration: RuntimeUpdateRestoration): Promise<void> {
  if (!plan.configuration) return;
  const guardianPlan = async (file: string, intentSha256?: string, owner?: RuntimeUpdateIdentity) => {
    const { readSupervisorTransition, supervisorTransitionIntentDigest } = await import('./supervisor-transition.js');
    const transition = await readSupervisorTransition(file), digest = supervisorTransitionIntentDigest(transition);
    if (transition.before.instanceHome !== plan.instance || transition.before.scope !== plan.before.scope || transition.before.owner.artifact !== plan.before.owner ||
        transition.before.backend.artifact !== plan.target.artifact || transition.after.backend.artifact !== plan.before.guardian ||
        transition.backend.runtime !== plan.before.backend || transition.owner.id === plan.before.ownerId ||
        (owner && (transition.owner.id !== owner.ownerId || transition.owner.pid !== owner.ownerPid)) ||
        (intentSha256 && digest !== intentSha256)) throw Error('Guardian transaction differs from the reviewed runtime restoration');
    return { phase: transition.phase, reference: { file, intentSha256: digest } };
  };
  const resumeGuardian = async (reference: NonNullable<ReturnType<RuntimeUpdateRestoration['guardian']>>) => {
    const { phase } = await guardianPlan(reference.file, reference.intentSha256);
    if (phase === 'complete') return;
    if (phase === 'prepared') await call(['backend', 'guardian', 'apply', reference.file, '--check']);
    await call(['backend', 'guardian', 'apply', reference.file]);
  };
  // A retired/configured guardian may have no healthy backend yet. Its own
  // durable transaction verifies native ownership before resuming that stage.
  const pending = restoration.guardian();
  if (pending) await resumeGuardian(pending);
  let roles = await observe();
  if (roles.owner !== plan.before.owner || roles.ownerId === plan.before.ownerId ||
      ![plan.target.artifact, plan.before.backend].includes(roles.backend))
    throw Error('Cannot complete restoration without its verified replacement owner and controller');
  if (roles.backend === plan.target.artifact && roles.guardian === plan.target.artifact) {
    await accept();
    if (plan.before.backend !== plan.target.artifact) {
      await call(['backend', 'upgrade', path.join(plan.instance, 'runtime/releases', plan.before.backend, cliDist)]);
      roles = await observe();
    }
  }
  if (roles.backend !== plan.before.backend) throw Error('Previous backend restoration is unconfirmed');
  if (roles.guardian !== plan.before.guardian) {
    if (pending) throw Error('Recorded guardian restoration is unconfirmed');
    if (roles.guardian !== plan.target.artifact) throw Error('Guardian changed outside the reviewed restoration');
    const transition = await call<{ file: string }>(['backend', 'guardian', 'prepare', path.join(plan.instance, 'runtime/releases', plan.before.guardian, cliDist)]);
    const { phase, reference } = await guardianPlan(transition.file, undefined, roles);
    if (phase !== 'prepared') throw Error('A new guardian restoration must be prepared before its first effect');
    await restoration.recordGuardian(reference);
    await resumeGuardian(reference);
  }
}

/** Native supervision and application admission share the local update authority. */
export async function runtimeUpdateActions({ runtime: reference, instance: home, call, run, progress = () => {} }: {
  runtime: VerifiedRuntimeReference; instance: string; call: RuntimeUpdateCall; run: ReleaseCommand; progress?: (message: string) => void;
}): Promise<RuntimeUpdateActions> {
  const runtime = reference.directory;
  const installation = path.join(home, 'runtime');
  const installed = (id: string) => {
    if (!hash.test(id)) throw Error('The operation requires an installed runtime SHA-256');
    return path.join(installation, 'releases', id);
  };
  const manifest = await inspectedRuntime(reference);
  const [{ readManagedRuntime, verifyManagedIsolation }, { assertCleanManagedShutdown }, { assertResidentServicesStopped },
    { getContainerState, listManagedContainers }, { assertConsoleOwnership, consoleContainerName }, { readProcessLifetime }, { readSavedDaemonConfig },
    { createDaemonClient }, { assertBackendMigrationsCompatible }] = await Promise.all([
    import('./managed-runtime.js'), import('./owner-reconciliation.js'), import('../commands/service-resident.js'),
    import('../infrastructure/container-runtime.js'), import('../webapp/console-container.js'),
    import('@omnitron-dev/common/process-identity'), import('../config/saved.js'),
    import('./daemon-client.js'), import('./backend-candidate.js'),
  ]);
  // Human-only lifecycle commands must not inherit the enclosing JSON RPC envelope.
  const raw = (id: string, args: string[]) => run(home, path.join(installed(id), 'node'), [path.join(installed(id), cliDist, 'cli/omnitron.js'), ...args], {
    timeoutMs: 10 * 60_000, env: { OMNITRON_OUTPUT: 'human' },
  });
  const observeCall = <T>(args: readonly string[], observation?: RuntimeObservation): Promise<T> =>
    call<T>(args, undefined, observation ? { timeoutMs: observation.remaining(), signal: observation.signal } : undefined);
  const consoleState = async (observation?: RuntimeObservation) => {
    const service = await observeCall<{ running: boolean; port: number }>(['webapp', 'status'], observation);
    const state = await getContainerState(consoleContainerName(home), { orThrow: true, fullId: true });
    if (Boolean(readSavedDaemonConfig()?.webapp) !== service.running) throw Error('Serving Console disagrees with its saved boot policy');
    if (!service.running && (!state || state.status === 'exited')) return { artifact: null, commit: null };
    if (!state || !service.running || !Number.isSafeInteger(service.port) || service.port < 1 || service.port > 65535) throw Error('Console has no verified serving address');
    assertConsoleOwnership(state, home);
    const mount = state.mounts?.find(volume => volume.target === '/usr/share/nginx/html');
    const id = mount && path.relative(path.join(installation, 'releases'), mount.source).split(path.sep)[0];
    if (!mount || !id || !hash.test(id) || mount.source !== path.join(installed(id), 'packages/0/webapp/dist')) throw Error('Serving Console does not have a verified installed rollback artifact');
    const timeout = AbortSignal.timeout(observation?.remaining(5000) ?? 5000);
    const response = await fetch(`http://127.0.0.1:${service.port}/BUILD.json`, { redirect: 'error', cache: 'no-store',
      signal: observation ? AbortSignal.any([observation.signal, timeout]) : timeout });
    const actual = response.ok ? await response.json() as BuildStamp : null;
    if (!cleanBuild(actual) || actual.commit !== await runtimeBuildCommit(installed(id), true)) throw Error('Console HTTP build disagrees with its mounted release');
    return { artifact: id, commit: actual.commit };
  };
  const installationState = async (observation?: RuntimeObservation) => {
    const state = await observeCall<{ directory: string; selection: RuntimeSelection | null; activation: unknown }>(['backend', 'installation'], observation);
    if (state.directory !== installation || (!state.selection || !hash.test(state.selection.current)) || state.activation) throw Error('Local native installation is unsettled or belongs to another instance');
    return state.selection;
  };
  const identity = async (status: RuntimeUpdateStatusObservation, idle = true, observation?: RuntimeObservation): Promise<RuntimeUpdateIdentity> => {
    if (idle) assertLocalIdle(status);
    const execution = status.execution;
    const config = await readManagedRuntime(home);
    if (!config || execution?.mode !== 'resident' || execution.connection?.status !== 'connected' || execution.phase !== 'active' ||
        !Array.isArray(status.apps) || !execution.owner?.id || !Number.isSafeInteger(execution.supervision?.guardianPid)) throw Error('Live native execution identity is incomplete');
    if (process.platform !== 'darwin' || config.scope !== 'user') throw Error('This development rollout requires a macOS user installation. Use the managed fleet workflow for servers');
    assertLocalServiceTargets(config);
    const selection = await installationState(observation);
    const ownerPid = execution.owner.pid, guardianPid = execution.supervision!.guardianPid;
    await verifyManagedIsolation(config, ownerPid, guardianPid, status.pid);
    const parent = await run(home, '/bin/ps', ['-p', String(status.pid), '-o', 'ppid='], {
      timeoutMs: observation?.remaining(5000) ?? 5000, ...(observation && { signal: observation.signal }),
    });
    if (Number(parent.trim()) !== guardianPid) throw Error('Serving backend is not a child of the reviewed native guardian');
    const life = readProcessLifetime(ownerPid);
    if (life.state !== 'alive') throw Error('Cannot establish execution owner process lifetime');
    if (!cleanBuild(status.build) || await runtimeBuildCommit(installed(selection.current)) !== status.build.commit ||
        !cleanBuild(execution.ownerBuild) || await runtimeBuildCommit(installed(config.owner.artifact)) !== execution.ownerBuild.commit) throw Error('Native roles disagree with the serving backend or owner');
    const retired = status.apps.flatMap(app => [app.pid, ...(app.processes ?? []).map(worker => worker.pid)]).filter(pid => pid !== null && pid !== undefined);
    if (![status.pid, ownerPid, guardianPid, ...retired].every(pid => Number.isSafeInteger(pid) && pid > 0)) throw Error('Invalid native application process identity');
    return { backend: selection.current, owner: config.owner.artifact, guardian: config.backend.artifact,
      backendCommit: status.build.commit, ownerCommit: execution.ownerBuild.commit, scope: config.scope, ownerId: execution.owner.id,
      ownerPid, ownerLifetime: life.identity, guardianPid, backendPid: status.pid, revision: selection.revision,
      retiredPids: [...new Set([status.pid, guardianPid, ...retired])].sort((a, b) => a - b) };
  };
  const inventory = async (status: RuntimeUpdateStatusObservation, observation?: RuntimeObservation) => {
    const projects = await observeCall<RuntimeUpdateProjectObservation>(['project', 'list'], observation);
    if (projects?.online !== true) throw Error('A live project catalogue is required');
    return localStackInventory(projects, projects.projects.length ? await observeCall<RuntimeUpdateStackObservation[]>(['stack', 'list'], observation) : [], status);
  };
  const watches = async (stacks: RuntimeUpdateStack[], observation?: RuntimeObservation) => {
    const client = createDaemonClient(undefined, observation?.remaining());
    try {
      const all = new Map(stacks.flatMap(s => s.apps.map(a => [a.handleKey, a])));
      const view = await client.getWatchStatus();
      if (!Array.isArray(view.apps) || (view.apps.length && (!view.enabled || !view.watching))) throw Error('Development source watches cannot be verified');
      const seen = new Set<string>();
      return view.apps.map(watch => {
        if (seen.has(watch.name) || !all.has(watch.name) || watch.generation !== all.get(watch.name)!.generation || !path.isAbsolute(watch.directory))
          throw Error('Source watch disagrees with the running application generation: ' + watch.name);
        seen.add(watch.name);
        return { name: watch.name, directory: watch.directory };
      }).sort((a, b) => a.name.localeCompare(b.name));
    } finally { await client.disconnect(); }
  };
  const runtimeControl = async <T>(body: (service: BackendControlService) => Promise<T>, expectedPid?: number): Promise<T> => {
    const client = createDaemonClient();
    let address: { socket: string };
    try { address = await (await client.service<BackendRpcService>('OmnitronBackend')).controlAddress(); }
    finally { await client.disconnect(); }
    const control = await privateControlClient<BackendControlService>(address.socket, 'OmnitronBackendControl', 10 * 60_000);
    try {
      const status = await control.service.status();
      if (status.instanceHome !== home || status.runtimeRestartProtocol !== 1 || status.runtimeRestartAdmissionProtocol !== 1 ||
          expectedPid !== undefined && status.pid !== expectedPid)
        throw Error('The serving controller cannot admit the reviewed local update; update the backend through its managed handoff before preparing an owner update');
      return await body(control.service);
    } finally { await control.close(); }
  };
  const retainedConfiguration = async (stacks: RuntimeUpdateStack[]): Promise<RuntimeRestartConfiguration> =>
    runtimeControl(service => service.runtimeRestart({ stacks: stacks.map(stack => stack.runtimeScope) }));
  const retainedReview = async (stacks: RuntimeUpdateStack[]): Promise<RuntimeRestartReview> =>
    runtimeControl(service => service.runtimeRestartReview({ stacks: stacks.map(stack => stack.runtimeScope) }));
  const sameRetainedIntent = async (plan: RuntimeUpdatePlan, current: RuntimeRestartConfiguration): Promise<boolean> => {
    if (!plan.configuration) return false;
    const retained = await readRestartConfiguration(home, plan.configuration.sha256);
    return restartIntentDigest(retained) === restartIntentDigest(current);
  };
  const backupReview = async (current: OperationReceipt[], reviewed?: OperationReceipt[]) => {
    if (!reviewed) return retainReviewedBackups(current, reviewed, async () => null);
    const client = createDaemonClient();
    try {
      return await retainReviewedBackups(current, reviewed, async id =>
        (await client.service<BackupRpcService>('OmnitronBackups')).getOperation({ id }));
    } finally { await client.disconnect(); }
  };
  const verifyPreviousOwnerDefaults = async (configuration: RuntimeRestartConfiguration) => {
    const managed = await readManagedRuntime(home);
    if (!managed) throw Error('Retained restart requires managed execution');
    const { loadRegisteredStartupEcosystem } = await import('./startup-config.js');
    assertRestartOwnerDefaults(await loadRegisteredStartupEcosystem(managed.cwd), configuration.watchConfig);
  };
  const verifyRetainedLaunches = async (plan: RuntimeUpdatePlan, ownerId: string, observation?: RuntimeObservation) => {
    if (!plan.configuration) return;
    const configuration = await readRestartConfiguration(home, plan.configuration.sha256);
    const managed = await readManagedRuntime(home);
    if (!managed) throw Error('Retained launch verification requires managed execution');
    const owner = await privateControlClient<ExecutionHostService>(path.join(managed.directory, 'owner.sock'), 'OmnitronExecution', observation?.remaining());
    try {
      const snapshot = await owner.service.snapshot();
      if (snapshot.status.owner.id !== ownerId) throw new RuntimeObservationConflict('Replacement owner changed during application observation');
      if (snapshot.status.phase !== 'active') throw new RuntimeObservationConflict('Replacement owner is no longer active');
      if (snapshot.status.inFlight !== 0) throw new RuntimeObservationPending('applications', 'Replacement owner has unsettled applications');
      for (const stack of configuration.stacks) for (const expected of stack.launches) {
        const actual = snapshot.apps.find(app => app.info.name === expected.name)?.entry;
        if (!actual || !isDeepStrictEqual(restartLaunchIntent(actual), restartLaunchIntent(expected)))
          throw new RuntimeObservationConflict('Application differs from the retained next-start intent: ' + expected.name);
      }
    } finally { await owner.close(); }
  };
  const startReview = async (stack: RuntimeUpdateStack, observation?: RuntimeObservation): Promise<{ digest: string; selection: RuntimeUpdateSelection }> => {
    const args = ['stack', 'start', stack.project, stack.stack, '--infrastructure', 'preserve'];
    const review = await observeCall<StackStartReview>([...args, '--dry-run'], observation);
    const inspected = review.targets?.[0]?.infrastructure;
    if (!(typeof review.digest === 'string' && hash.test(review.digest)) || review.project !== stack.project || review.stack !== stack.stack || review.targets?.length !== 1 ||
        review.targets[0]!.node !== 'local' || !Array.isArray(inspected?.containers)) throw Error('Cannot establish launch and infrastructure for ' + projectKey(stack) + ': ' + (review.targets?.find(v => v.reason)?.reason || 'incomplete preservation review'));
    let selection: RuntimeUpdateSelection;
    if (typeof review.selection?.release === 'string' && !review.selection.workingTree) {
      if (stack.selection.kind === 'release') {
        if (stack.selection.id !== review.selection.release) throw Error('Saved and reviewed releases disagree for ' + projectKey(stack));
        selection = stack.selection;
      } else {
        const release = await observeCall<SelectedRelease>(['release', 'show', review.selection.release], observation);
        if (release.id !== review.selection.release || !hash.test(release.manifestSha256)) throw Error('Release identity is incomplete for ' + projectKey(stack));
        selection = { kind: 'release', id: release.id, manifestSha256: release.manifestSha256 };
      }
    } else if (review.selection?.workingTree === true && !review.selection.release && stack.selection.kind !== 'release') selection = { kind: 'working-tree' };
    else throw Error('Saved launch and reviewed release disagree for ' + projectKey(stack));
    return { digest: review.digest, selection };
  };
  const coldPreview = async (artifact: string, observation?: RuntimeObservation): Promise<RuntimeUpdateInfrastructure> => {
    const response = await observeCall<ColdStartObservation>(['backend', 'select', artifact, '--check'], observation);
    const infra = response.infrastructure;
    if (!response.checked || response.candidate !== artifact || !['certified-declarations', 'reviewed-declarations'].includes(infra?.coverage ?? '') || !Array.isArray(infra?.containers) ||
        !hash.test(infra.intentDigest) || infra.containers.some(v => v.action !== 'retain' || !hash.test(v.id)) ||
        (infra.controlPlaneDatabase && infra.controlPlaneDatabase.action !== 'retain')) throw Error('Automatic local restart requires verified retained infrastructure; inspect backend select ' + artifact + ' --check for the proposed changes');
    return { schemaScope: response.schemaScope, ...(response.coldStackAdmissionProtocol === 1 && { coldStackAdmissionProtocol: 1 as const }),
      ...(response.runtimeRestartProtocol === 1 && { runtimeRestartProtocol: 1 as const }), digest: infra.intentDigest, containers: infra.containers.map(({ name, id }) => ({ name, id })).sort((a, b) => a.name.localeCompare(b.name)),
      database: infra.controlPlaneDatabase?.id ?? null };
  };
  const stopped = async (previous: RuntimeUpdateIdentity) => {
    const config = await readManagedRuntime(home);
    if (!config || config.scope !== previous.scope) throw Error('Native service instance changed');
    assertLocalServiceTargets(config);
    assertResidentServicesStopped(config.scope);
    await assertCleanManagedShutdown(config, { pid: previous.ownerPid, lifetime: previous.ownerLifetime }, previous.retiredPids);
  };
  const sameOwner = (a: RuntimeUpdateIdentity, b: RuntimeUpdateIdentity) => (['scope', 'ownerId', 'ownerLifetime', 'ownerPid', 'guardianPid', 'backendPid', 'revision', 'backend', 'guardian', 'owner'] as const).every(k => a[k] === b[k]);
  const accept = async (plan: RuntimeUpdatePlan, direction: 'target' | 'previous', inspected = false, interim = false) => {
    const target = direction === 'target', expect = target || interim ? plan.target.artifact : plan.before.backend;
    const observe = async (observation?: RuntimeObservation) => {
      const status = await observeCall<RuntimeUpdateStatusObservation>(['status'], observation);
      const roles = await identity(status, false, observation);
      if (roles.backend !== expect || roles.guardian !== (target || interim ? expect : plan.before.guardian) ||
          roles.owner !== (target ? expect : plan.before.owner) || roles.ownerId === plan.before.ownerId)
        throw new RuntimeObservationConflict('The reviewed roles have not taken ownership');
      if (status.execution?.recovery?.status === 'pending')
        throw new RuntimeObservationPending('controller', status.execution.recovery.reason ?? 'Controller startup observation is pending', status.pid);
      if (status.execution?.recovery?.status !== 'ready') throw Error('The serving controller has no recovery readiness evidence');
      const [web, stacks] = await Promise.all([consoleState(observation), inventory(status, observation)]);
      if (web.artifact !== (target && plan.before.console ? expect : plan.before.console))
        throw new RuntimeObservationConflict('The serving Console has not reached its reviewed version');
      if (stacks.targets.length !== plan.stacks.length || !isDeepStrictEqual(stacks.excluded, plan.excluded))
        throw new RuntimeObservationConflict('Local stack membership differs from the plan');
      const observed = new Map(stacks.targets.map(stack => [projectKey(stack), stack]));
      const results = plan.stacks.map(prior => {
        const now = observed.get(projectKey(prior));
        if (!now || now.enabled !== prior.enabled || now.infrastructureMode !== prior.infrastructureMode || now.infrastructureReview !== prior.infrastructureReview || now.path !== prior.path || !isDeepStrictEqual(now.runtimeScope, prior.runtimeScope) ||
            now.apps.length !== prior.apps.length) throw new RuntimeObservationConflict('Stack intent differs from the plan: ' + projectKey(prior));
        if (now.status !== 'running') throw new RuntimeObservationPending('applications', 'Waiting for ' + projectKey(prior));
        assertSameSavedSelection(prior, now);
        for (const app of prior.apps) {
          const current = now.apps.find(v => v.handleKey === app.handleKey);
          if (current?.status !== 'online' || !current.generation || current.generation === app.generation)
            throw new RuntimeObservationPending('applications', 'Waiting for a verified new generation of ' + app.handleKey);
          try { assertRuntimeUpdateHealth(app, current); }
          catch (error) {
            if (error instanceof RuntimeUpdateHealthRegression) throw new RuntimeObservationPending('health', error.message);
            throw error;
          }
          if ((app.release && !isDeepStrictEqual(current.release, app.release)) || (prior.selection.kind === 'release' &&
              (current.release?.id !== prior.selection.id || current.release?.manifestSha256 !== prior.selection.manifestSha256)))
            throw new RuntimeObservationConflict('Running release differs from the plan: ' + app.handleKey);
        }
        return { project: now.project, stack: now.stack, selection: prior.selection, apps: now.apps.map(({ handleKey, generation, health, release }) => ({ handleKey, generation, health, release })) };
      });
      const watching = await watches(stacks.targets, observation);
      if (!isDeepStrictEqual(watching, plan.watches)) throw new RuntimeObservationConflict('The development stack has not restored its original source watches');
      await verifyRetainedLaunches(plan, roles.ownerId, observation);
      for (const prior of plan.configuration ? [] : plan.stacks) {
        const current = observed.get(projectKey(prior));
        if (!current) throw new RuntimeObservationConflict('Stack disappeared from the accepted inventory');
        const review = await startReview(current, observation);
        if (!isDeepStrictEqual(review.selection, prior.selection) || review.digest !== prior.startReview)
          throw new RuntimeObservationConflict('Launch declaration, volumes or runtime selection changed for ' + projectKey(prior));
      }
      let actual: RuntimeUpdateInfrastructure;
      try { actual = await coldPreview(expect, observation); }
      catch (error) {
        // JSON carries an explicit pending code from the serving process. A
        // foreign lease or an unclassified transport error is not startup work.
        const reported = error instanceof CommandResultError ? error.details['reported'] as { stage?: string; pid?: number } | undefined : undefined;
        if (error instanceof CommandResultError && error.code === 'RUNTIME_OBSERVATION_PENDING' &&
            reported?.pid === status.pid && ['installation', 'controller'].includes(reported.stage ?? ''))
          throw new RuntimeObservationPending(reported!.stage!, error.message, status.pid);
        throw error;
      }
      observation?.remaining();
      const retained = await listManagedContainers({ orThrow: true, checkNames: new Set(plan.infrastructure.containers.map(container => container.name)) });
      assertRetainedRuntimeInfrastructure(plan.infrastructure, actual, retained);
      observation?.remaining();
      return { backend: roles.backend, owner: roles.owner, guardian: roles.guardian, ownerId: roles.ownerId, console: web, stacks: results, watches: watching };
    };
    const verify = async (observation: RuntimeObservation) => {
      try { return await observe(observation); }
      catch (error) {
        if (error instanceof RuntimeObservationPending || error instanceof RuntimeObservationConflict || error instanceof RuntimeObservationUnconfirmed) throw error;
        throw new RuntimeObservationUnconfirmed('Local batch acceptance is unconfirmed: ' + (error instanceof Error ? error.message : String(error)), error);
      }
    };
    if (!inspected) progress('Waiting for the serving Console and independently observed application generations');
    return inspected ? withRuntimeObservation(verify, 15 * 60_000, 'Local batch inspection remains unconfirmed')
      : observeRuntimeUntil(verify, 15 * 60_000, 'Local batch acceptance remains unconfirmed', 2000, progress);
  };

  const completeRestore = async (plan: RuntimeUpdatePlan, restoration: RuntimeUpdateRestoration) => {
    await restoreRuntimeRoles(plan, () => until('Waiting for the restored controller',
      async () => identity(await call<RuntimeUpdateStatusObservation>(['status'])), 10 * 60_000),
    () => accept(plan, 'previous', false, true), call, restoration);
  };
  return {
    async prepare(reviewed?: RuntimeUpdatePlan): Promise<RuntimeUpdatePlan> {
      await inspectedRuntime(reference);
      const live = await call<RuntimeUpdateStatusObservation>(['status']);
      assertLocalReview(live);
      const [before, stacks, web] = await Promise.all([identity(live, false), inventory(live), consoleState()]);
      const existing = await fs.lstat(installed(manifest.sha256)).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      let candidate;
      if (existing) {
        if (existing.isSymbolicLink() || !existing.isDirectory()) throw Error('Invalid installed runtime directory');
        if (installed(manifest.sha256) === runtime) await inspectedRuntime(reference);
        else await verifyRuntimeArtifact(installed(manifest.sha256), manifest.sha256);
        candidate = { id: manifest.sha256, directory: installed(manifest.sha256), build: { commit: await runtimeBuildCommit(installed(manifest.sha256)), dirty: false } };
      } else candidate = await call<{ id: string; directory: string; build: BuildStamp }>(['backend', 'install', runtime]);
      if (candidate.id !== manifest.sha256 || candidate.directory !== installed(candidate.id) || !cleanBuild(candidate.build) || candidate.build.commit !== await runtimeBuildCommit(runtime, true)) throw Error('Installed candidate or Console differs from the sealed checkout');
      const infrastructure = await coldPreview(candidate.id);
      if (before.backend !== candidate.id) {
        await assertBackendMigrationsCompatible(path.join(installed(candidate.id), cliDist), path.join(installed(before.backend), cliDist), infrastructure.schemaScope);
        await coldPreview(before.backend);
      }
      if (infrastructure.runtimeRestartProtocol !== 1 || infrastructure.coldStackAdmissionProtocol !== 1)
        throw Error('The target controller cannot restore retained next-start definitions');
      const protocol = 1;
      // Both directions use the target controller for application restoration.
      // The previous backend is restored through its existing warm handoff.
      const review = await retainedReview(stacks.targets);
      const configuration = review.configuration;
      const backupOperations = await backupReview(review.backups, reviewed?.backupOperations);
      if (configuration.ownerId !== before.ownerId) throw Error('Retained configuration belongs to another owner');
      await verifyPreviousOwnerDefaults(configuration);
      const targets: ReviewedRuntimeUpdateStack[] = [];
      for (const stack of stacks.targets) {
        const retained = configuration.stacks.find(value => value.project === stack.runtimeScope.project && value.stack === stack.runtimeScope.stack);
        if (!retained?.review.digest || retained.path !== stack.path) throw Error('Retained stack review is incomplete');
        const selection: RuntimeUpdateSelection = retained.selection ? { kind: 'release', ...retained.selection } : { kind: 'working-tree' };
        assertReviewedBoot(stack, retained.review.digest, protocol);
        targets.push({ ...stack, savedSelection: stack.selection, selection, startReview: retained.review.digest });
      }
      const watching = await watches(stacks.targets);
      for (const id of new Set([before.backend, before.owner, before.guardian, web.artifact].filter((artifact): artifact is string => typeof artifact === 'string'))) {
        if (id !== candidate.id) await verifyRuntimeArtifact(installed(id), id);
      }
      const finalStatus = await call<RuntimeUpdateStatusObservation>(['status']);
      assertLocalReview(finalStatus);
      const after = await identity(finalStatus, false);
      if (!isDeepStrictEqual(before, after)) throw Error('Local execution changed during preparation. Inspect the current plan');
      const sha256 = reviewed && await sameRetainedIntent(reviewed, configuration)
        ? reviewed.configuration!.sha256 : await saveRestartConfiguration(home, configuration);
      return { protocol: 1, stackAdmissionProtocol: protocol, configuration: { sha256, basis: 'retained-next-start' }, backupOperations, instance: home, target: { artifact: candidate.id, commit: candidate.build.commit },
        before: { ...before, console: web.artifact, consoleCommit: web.commit }, stacks: targets, excluded: stacks.excluded, watches: watching, infrastructure };
    },
    async admit(plan, planDigest) {
      if (!plan.configuration) throw Error('Runtime update admission requires retained next-start intent');
      const reviewed = await retainedReview(plan.stacks);
      if (!await sameRetainedIntent(plan, reviewed.configuration)) throw Error('Retained next-start intent changed before backup admission');
      await backupReview(reviewed.backups, plan.backupOperations);
      const configuration = await runtimeControl(service => service.runtimeRestartPrepare({ planDigest,
        stacks: plan.stacks.map(stack => stack.runtimeScope), configurationSha256: restartConfigurationDigest(reviewed.configuration),
        backups: plan.backupOperations }), plan.before.backendPid);
      if (!await sameRetainedIntent(plan, configuration))
        throw Error('Retained next-start intent changed during backup admission');
    },
    async releaseAdmission(plan, planDigest) {
      await runtimeControl(service => service.runtimeRestartRelease({ planDigest }), plan.before.backendPid);
    },
    async validateStop(previous, plan) {
      if (plan) {
        if (plan.configuration) {
          const configuration = await retainedConfiguration(plan.stacks);
          if (!await sameRetainedIntent(plan, configuration))
            throw Error('Retained next-start intent changed before shutdown');
          await verifyPreviousOwnerDefaults(configuration);
        }
        const infra = await coldPreview(plan.target.artifact);
        if (!isDeepStrictEqual(infra, plan.infrastructure)) throw Error('Cold-start infrastructure changed before shutdown');
      }
      const observed = await identity(await call<RuntimeUpdateStatusObservation>(['status']));
      if (!sameOwner(previous, observed) || !isDeepStrictEqual(previous.retiredPids, observed.retiredPids)) throw Error('Native ownership or worker set changed before shutdown');
    },
    stop: previous => raw(previous.backend, ['down']),
    assertStopped: previous => until('Clean shutdown could not be confirmed', () => stopped(previous), 90_000),
    async canRestore(previous) { try { await stopped(previous); return true; } catch { return false; } },
    async isPreviousServing(this: RuntimeUpdateActions, plan) {
      try {
        await this.validateStop(plan.before, plan);
        return true;
      } catch { return false; }
    },
    async captureForRollback(plan) {
      const live = await identity(await call<RuntimeUpdateStatusObservation>(['status']));
      if (live.ownerId === plan.before.ownerId || live.backend !== plan.target.artifact || live.owner !== plan.target.artifact || live.guardian !== plan.target.artifact) throw Error('Cannot identify the candidate as the exclusive serving owner');
      return live;
    },
    async start(destination, plan, restoration) {
      assertLocalServiceTargets(await readManagedRuntime(home));
      const restoring = !('artifact' in destination);
      if (restoring && plan.configuration && !restoration) throw Error('Runtime restoration requires its durable receipt');
      const backend = 'artifact' in destination ? destination.artifact : plan.configuration ? plan.target.artifact : destination.backend;
      const owner = 'artifact' in destination ? destination.artifact : destination.owner;
      if (restoring && plan.configuration)
        await verifyPreviousOwnerDefaults(await readRestartConfiguration(home, plan.configuration.sha256));
      const selected = await call<{ selection: RuntimeSelection | null }>(['backend', 'select', backend]);
      if (selected?.selection?.current !== backend) throw Error('Native selector did not confirm the reviewed backend');
      const args = ['service', 'install', '--scope', plan.before.scope, '--owner-runtime', owner];
      await raw(backend, [...args, '--prepare']);
      await raw(backend, args);
      const guardian = 'guardian' in destination ? destination.guardian : backend;
      if (guardian !== backend && !plan.configuration) {
        // Service install binds the guardian to the selected backend. Restore an independently pinned guardian through its own handoff.
        await until('Waiting for the restored controller', async () => assertLocalIdle(await call<RuntimeUpdateStatusObservation>(['status'])), 10 * 60_000);
        const transition = await call<{ file: string }>(['backend', 'guardian', 'prepare', path.join(installed(guardian), cliDist)]);
        await call(['backend', 'guardian', 'apply', transition.file, '--check']);
        await call(['backend', 'guardian', 'apply', transition.file]);
      }
      const web = 'artifact' in destination ? (plan.before.console && backend) : destination.console;
      if (web && web !== backend) {
        // The selected backend owns Console autostart. Starting the same
        // container here races that lifecycle and can reject a successful boot.
        // A rollback with a separately pinned Console still selects it explicitly.
        await until('Waiting for the selected backend', async () => {
          const status = await call<{ build: BuildStamp | null }>(['backend', 'status']);
          if (status.build?.commit !== await runtimeBuildCommit(installed(backend))) throw Error('Selected backend is starting');
        }, 5 * 60_000);
        await call(['webapp', 'start'], installed(web));
      }
      if (restoring && plan.configuration) await completeRestore(plan, restoration!);
    },
    completeRestore,
    accept,
  };
}
