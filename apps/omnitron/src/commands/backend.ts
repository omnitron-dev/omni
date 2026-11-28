import path from 'node:path';
import fs from 'node:fs/promises';
import { createDaemonClient, isRequestTimeout } from '../daemon/daemon-client.js';
import type { BackendRpcService } from '../daemon/backend.rpc-service.js';
import { replaceBackend, recoverBackend, abortBackendReplacement, type BackendReplacementPreflight } from '../daemon/backend-upgrade.js';
import { emitJson, emitError, emitInfo, emitStep } from './output.js';
import { RuntimeInstallation, assertOrdinaryRecoveryAllowed } from '../daemon/runtime-installation.js';
import { PidManager } from '../daemon/pid-manager.js';
import { DEFAULT_DAEMON_CONFIG, DEFAULT_SOCKET_PATH } from '../config/defaults.js';
import { getEnv } from '../shared/env-config.js';
import { expandPath } from '../shared/paths.js';
import { executionDirectory } from '../daemon/execution-launcher.js';
import { readSavedDaemonConfig, savedDaemonOverrides } from '../config/saved.js';
import { assertBackendMigrationsCompatible, backendSchemaScope, previewBackendColdStart, type BackendArtifact } from '../daemon/backend-candidate.js';
import { BackendRecoveryJournal } from '../daemon/backend-recovery-journal.js';
import { assertBackendHandoffAdmission, assertBackendHandoffReview, checkpointInstanceHome } from '../daemon/backend-handoff-types.js';
import { readPrivateRecord } from '../daemon/execution-journal.js';
import { privateControlClient } from '../daemon/private-control-client.js';
import { observeRuntimeUntil, RuntimeObservationPending } from '../daemon/runtime-observation.js';
import type { BackendControlService } from '../daemon/backend-control.js';
import { readManagedRuntime } from '../daemon/managed-runtime.js';
import { recoverBackendAfterCrash } from '../daemon/backend-crash-recovery.js';

export async function backendSchemaPrepareCommand(directory: string, options: { fromPlan?: string } = {}): Promise<void> {
  try {
    const { prepareSchemaTransition } = await import('../daemon/schema-transition.js');
    const result = await prepareSchemaTransition(path.resolve(directory), undefined, options.fromPlan);
    if (!emitJson(result)) {
      emitInfo(`Schema plan: ${result.file}`);
      for (const migration of result.plan.additions) emitInfo(`${migration.name}: ${migration.description}`);
      emitInfo('Review the plan, then apply it before replacing the backend.');
    }
  } catch (error) { emitError(error); process.exitCode = 1; }
}

export async function backendSchemaApplyCommand(file: string): Promise<void> {
  try {
    const { applySchemaTransition } = await import('../daemon/schema-transition.js');
    const result = await applySchemaTransition(path.resolve(file));
    if (!emitJson(result)) emitInfo(`Schema expansion ${result.id} applied; the compatibility runtime can be retained for rollback.`);
  } catch (error) { emitError(error); process.exitCode = 1; }
}

export async function backendSupervisorPrepareCommand(directory: string, options: { recoveryCheckpoint?: string } = {}): Promise<void> {
  try {
    const { prepareSupervisorTransition } = await import('../daemon/supervisor-transition.js');
    const result = await prepareSupervisorTransition(path.resolve(directory), undefined, options);
    if (!emitJson(result)) {
      emitInfo(`Guardian plan: ${result.file}`);
      emitInfo(`Owner PID ${result.plan.ownerPid} and the selected backend release will be preserved.`);
      if (result.plan.reviewedRecovery) {
        emitInfo('This plan accepts the current owner inventory and the last certified controller configuration. The historical execution difference is unknown; this does not certify that application definitions and every worker stayed unchanged during the failed transition.');
        emitInfo(`Reviewed intent SHA-256: ${result.plan.reviewedRecovery.intentSha256}`);
      }
    }
  } catch (error) { emitError(error); process.exitCode = 1; }
}

export async function backendSupervisorApplyCommand(file: string, checkOnly = false): Promise<void> {
  try {
    const { applySupervisorTransition } = await import('../daemon/supervisor-transition.js');
    const result = await applySupervisorTransition(path.resolve(file), { checkOnly });
    if (emitJson(result)) return;
    if (checkOnly) {
      emitInfo(result.phase === 'complete' ? 'Guardian transition already completed.' : `Guardian plan verified for execution owner PID ${result.ownerPid}.`);
      return;
    }
    emitInfo(`Guardian PID ${result.result?.guardianPid}; backend PID ${result.result?.backendPid}; execution owner PID ${result.ownerPid} preserved`);
  } catch (error) { emitError(error); process.exitCode = 1; }
}

export async function backendInstallCommand(directory: string): Promise<void> {
  let installation: RuntimeInstallation | null = null;
  try {
    installation = await RuntimeInstallation.open();
    if (!installation) throw new Error('Cannot open runtime installation');
    const artifact = await installation.exclusive(() => installation!.install(path.resolve(directory)));
    if (!emitJson({ id: artifact.runtimeHash, directory: artifact.runtimeRoot, build: artifact.build, selected: false })) {
      emitInfo(`Installed ${artifact.build.commit}: ${artifact.runtimeHash}`);
      emitInfo('Running applications and the startup selection are unchanged.');
    }
  } catch (error) { emitError(error); process.exitCode = 1; }
  finally { await installation?.close(); }
}

export async function backendInstallationCommand(options: { recovery?: boolean } = {}): Promise<void> {
  let installation: RuntimeInstallation | null = null;
  try {
    installation = await RuntimeInstallation.openReadOnly();
    if (options.recovery && !installation) throw Error('No runtime installation exists');
    const recovery = options.recovery && installation
      ? await (await import('../daemon/reviewed-backend-recovery.js')).inspectHeldBackendRecovery(installation) : undefined;
    const state = { directory: installation?.directory ?? null, selection: installation?.selection() ?? null,
      activation: installation?.activation() ?? null, ...(recovery && { recovery }) };
    if (!emitJson(state)) {
      emitInfo(state.selection ? `Cold-start runtime: ${state.selection.current} (revision ${state.selection.revision})` : 'No runtime is selected for cold start');
      if (state.directory) emitInfo(`Installation: ${state.directory}`);
      if (state.activation) emitInfo(`Unfinished activation: ${state.activation.checkpoint}`);
      const hold = state.activation?.reviewedRecovery;
      if (hold) {
        emitInfo(`Reviewed recovery ${hold.phase} (${hold.planFile})`);
        if (hold.checkpoint) emitInfo(`Admitted checkpoint: ${hold.checkpoint}`);
      }
      if (recovery) {
        emitInfo(`Durable controller epoch ${recovery.durableEpoch ?? 'unknown'} (admitted ${recovery.admittedEpoch}), grant ${recovery.durableGrantMatches ? 'matches' : 'differs'}, registry ${recovery.registryMatches ? 'matches' : 'differs'}`);
        emitInfo(`Certificate ${recovery.certificate}, writer PID ${recovery.writerPid ?? 'unknown'} (${recovery.writerPidState ?? 'unknown'}), project state ${recovery.projectState}`);
        if (recovery.invalidation) emitInfo(`Invalidated at ${recovery.certificateAt} by ${recovery.invalidation.reasons.join(', ')} (${recovery.invalidation.history}). No later project snapshot is certified.`);
        if (recovery.currentStateReview) emitInfo(`Cold recovery review: ${recovery.currentStateReview}. Inspect with omnitron backend recover --current-state --check.`);
      }
    }
  } catch (error) { emitError(error); process.exitCode = 1; }
  finally { await installation?.close(); }
}

export async function coldStartPreview(artifact: BackendArtifact, config: typeof DEFAULT_DAEMON_CONFIG, home: string) {
  if (artifact.coldInfrastructureProtocol !== 1) return { coverage: 'unavailable', reason: 'Candidate predates cold infrastructure preview' } as const;
  const pid = new PidManager(expandPath(config.pidFile)).getPid();
  if (pid !== null) {
    // A live review can observe owned backups without cancelling them. Never
    // mistake it for a durable recovery certificate or fall back after refusal.
    const client = createDaemonClient(expandPath(config.socketPath));
    let address: { socket: string };
    try { address = await (await client.service<BackendRpcService>('OmnitronBackend')).controlAddress(); }
    finally { await client.disconnect(); }
    const control = await privateControlClient<BackendControlService>(address.socket, 'OmnitronBackendControl');
    try {
      const status = await control.service.status();
      if (status.pid !== pid || path.resolve(status.instanceHome) !== path.resolve(home) ||
          status.retired || status.ticketId || status.backendHandoffReviewProtocol !== 1)
        throw Error('Cold infrastructure review requires the selected live controller');
      const review = await control.service.handoffReview();
      assertBackendHandoffReview(review, { pid, entry: status.entry, instanceHome: home,
        ownerId: status.runtime.owner?.id, epoch: status.runtime.epoch });
      const native = await previewBackendColdStart(artifact, review.record);
      return { coverage: 'reviewed-declarations' as const, capturedAt: review.record.createdAt, ...native };
    } finally { await control.close(); }
  }
  const directory = executionDirectory(config);
  try { await fs.access(path.join(directory, 'recovery.db')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { coverage: 'unavailable', reason: 'No recorded infrastructure declaration' } as const;
  }
  const journal = new BackendRecoveryJournal(directory, { readOnly: true });
  try {
    const evidence = journal.read();
    const record = evidence?.status === 'ready' ? evidence.record : evidence?.previous;
    if (!record) return { coverage: 'unavailable', reason: 'No recorded infrastructure declaration' } as const;
    if (checkpointInstanceHome(record) !== home) throw Error('Cold infrastructure preview belongs to another instance');
    const native = await previewBackendColdStart(artifact, record);
    return { coverage: evidence?.status === 'ready' ? 'certified-declarations' : 'historical-declarations',
      capturedAt: record.createdAt, ...native } as const;
  } finally { await journal.close(); }
}

export async function backendSelectCommand(id: string, checkOnly = false, options: { schemaPlan?: string } = {}): Promise<void> {
  let installation: RuntimeInstallation | null = null;
  try {
    installation = checkOnly ? await RuntimeInstallation.openReadOnly() : await RuntimeInstallation.open(undefined, { existing: true });
    if (!installation) throw new Error('Cannot open runtime installation');
    const registry = installation;
    const check = async () => {
      const config = { ...DEFAULT_DAEMON_CONFIG, ...savedDaemonOverrides(readSavedDaemonConfig()) };
      if (registry.activation()) throw new Error('An activation is unfinished; recover or abort its checkpoint before selecting another release');
      const selected = checkOnly ? registry.settledSelection({ allowEmpty: true }) : registry.selection();
      const artifact = await registry.artifact(id);
      await (await import('../execution/operation-journal.js')).assertOperationJournalCompatibility(registry.home, artifact.directory);
      if (!selected?.bootstrap) {
        try { await fs.access(path.join(artifact.directory, 'cli/installed.js')); }
        catch { throw new Error('This release predates managed installation. Select a management-capable release first so rollback and recovery remain available.'); }
      }
      // Managed cold startup reads this instance's persisted role. Other launch
      // modes may override it and must retain the conservative comparison.
      const scope = await readManagedRuntime(registry.home) ? backendSchemaScope(config) : 'all';
      let schema: Awaited<ReturnType<typeof import('../daemon/schema-transition.js').validateSchemaTransitionForSelection>> | undefined;
      if (options.schemaPlan && (!selected || config.role !== 'master'))
        throw new Error('Applied schema selection requires an installed master runtime');
      if (selected) {
        const previous = await registry.artifact(selected.current);
        if (options.schemaPlan) {
          const { validateSchemaTransitionForSelection } = await import('../daemon/schema-transition.js');
          schema = await validateSchemaTransitionForSelection(options.schemaPlan, previous, artifact, registry);
        } else await assertBackendMigrationsCompatible(previous.directory, artifact.directory, scope);
      }
      return { selected, scope, config, artifact, schema };
    };
    if (checkOnly) {
      await registry.inspect(async () => {
        const { selected, scope, artifact, config, schema } = await check();
        const infrastructure = await coldStartPreview(artifact, config, registry.home);
        const confirmed = registry.settledSelection({ allowEmpty: true });
        if (confirmed?.revision !== selected?.revision || confirmed?.current !== selected?.current) throw new Error('Runtime selection changed during the check');
        if (!emitJson({ checked: true, current: selected?.current ?? null, candidate: id, schemaScope: scope, coldStackAdmissionProtocol: artifact.coldStackAdmissionProtocol ?? null,
          runtimeRestartProtocol: artifact.runtimeRestartProtocol ?? null, coldConsoleProtocol: artifact.coldConsoleProtocol ?? null,
          preparedConsoleProtocol: artifact.preparedConsoleProtocol ?? null, infrastructure, ...(schema && { schema }) })) {
          emitInfo(`Runtime selection and ${scope} migrations verified for ${id}.`);
          if ('containers' in infrastructure) {
            emitInfo(`Cold stack preview from ${infrastructure.coverage} at ${infrastructure.capturedAt}. Startup rechecks current declarations and native containers.`);
            const database = infrastructure.controlPlaneDatabase;
            if (database) emitInfo('Control-plane PostgreSQL: ' + database.action + (database.action === 'move-network'
              ? ` (${database.move.from} → ${database.move.to}, ${database.move.restartsPostgres ? 'PostgreSQL process restart; ' : ''}same container and volume, published SQL cluster ${database.move.systemId ?? 'unverified'})` : database.action === 'hold' ? ' — ' + database.reason : ''));
            for (const item of infrastructure.containers) {
              emitInfo(`${item.name}: ${item.action}${item.changed?.length ? ' (' + item.changed.join(', ') + ')' : ''}${item.reason ? ' — ' + item.reason : ''}`);
            }
          } else emitInfo('Stack infrastructure unverified: ' + infrastructure.reason);
        }
      });
      return;
    }
    const result = await registry.exclusive(async () => {
      const { selected, config, schema } = await check();
      if (new PidManager(expandPath(config.pidFile)).isRunning() ||
          new PidManager(path.join(executionDirectory(config), 'owner.pid')).isRunning()) {
        throw new Error('A backend or execution owner is running; use backend upgrade to retain application ownership');
      }
      const selection = await registry.select(id, selected?.revision ?? 0);
      const launcher = await registry.writeLauncher();
      return { selection, launcher, ...(schema && { schema }) };
    });
    if (!emitJson(result)) emitInfo(`Selected ${id}. Launch with ${result.launcher} up`);
  } catch (error) { emitError(error); process.exitCode = 1; }
  finally { await installation?.close(); }
}

export async function backendLauncherCommand(): Promise<void> {
  let installation: RuntimeInstallation | null = null;
  try {
    installation = await RuntimeInstallation.open(undefined, { existing: true });
    if (!installation) throw new Error('Cannot open runtime installation');
    const registry = installation;
    const result = await registry.exclusive(async () => {
      if (registry.activation()) throw new Error('Runtime activation is unfinished; launcher refresh is refused');
      const selection = registry.selection();
      if (!selection) throw new Error('No runtime is selected');
      return { selection, launcher: await registry.writeLauncher() };
    });
    if (!emitJson(result)) emitInfo(`CLI launcher refreshed: ${result.launcher}`);
  } catch (error) { emitError(error); process.exitCode = 1; }
  finally { await installation?.close(); }
}

export async function backendStatusCommand(): Promise<void> {
  const client = createDaemonClient();
  try {
    const status = await client.status().catch(async error => {
      // App inventory can be unavailable while the backend is healthy. The
      // dedicated control status does not read that inventory or its cache.
      const backend = await client.service<BackendRpcService>('OmnitronBackend');
      const [execution, ping] = await Promise.all([backend.status(), client.ping()]);
      return { ...ping, execution, build: undefined, inventoryError: error instanceof Error ? error.message : String(error) };
    });
    const execution = status.execution ?? { mode: 'coupled', handoffSupported: false,
      reason: 'The running backend predates resident execution. Its application processes cannot be adopted without an initial controlled restart.' };
    const inventoryError = 'inventoryError' in status ? status.inventoryError : undefined;
    if (emitJson({ pid: status.pid, build: status.build, execution, ...(inventoryError && { inventoryError }) })) return;
    emitInfo(`Backend PID ${status.pid}: ${execution.mode}`);
    if (execution.reason) emitInfo(execution.reason);
    if ('owner' in execution && execution.owner) emitInfo(`Execution owner PID ${execution.owner.pid}; epoch ${execution.epoch}; ${execution.phase}`);
    if ('connection' in execution && execution.connection) emitInfo(`Owner connection: ${execution.connection.status}; last observation ${execution.connection.observedAt ?? 'unknown'}${execution.connection.error ? `; ${execution.connection.error}` : ''}`);
    if ('recovery' in execution && execution.recovery) emitInfo(`Recovery checkpoint: ${execution.recovery.status}${execution.recovery.reason ? `; ${execution.recovery.reason}` : ''}`);
    if ('supervision' in execution && execution.supervision) emitInfo(`Independent OS supervision: guardian PID ${execution.supervision.guardianPid}; owner ${execution.supervision.ownerUnit}; backend ${execution.supervision.backendUnit}`);
    if (inventoryError) emitInfo(`Application inventory unavailable: ${inventoryError}`);
  } catch (error) { emitError(error); process.exitCode = 1; }
  finally { await client.disconnect(); }
}

export async function backendUpgradeCommand(directory: string, options: { check?: boolean; fromCheck?: string; schemaPlan?: string }): Promise<void> {
  try {
    let admission: BackendReplacementPreflight['admission'] | undefined;
    if (options.fromCheck) {
      if (options.check) throw Error('Use --check to prepare or --from-check to apply the saved review');
      const saved = await readPrivateRecord<{ ok: boolean; data?: BackendReplacementPreflight }>(path.resolve(options.fromCheck));
      if (saved?.ok !== true || saved.data?.checked !== true || !saved.data.admission?.targetRuntimeHash)
        throw Error('Supply the successful JSON response from backend upgrade --check for this destination');
      admission = saved.data.admission;
      assertBackendHandoffAdmission(admission);
    }
    // A socket chosen for another instance must keep its own RPC authority.
    const target = getEnv().OMNITRON_SOCKET ?? DEFAULT_SOCKET_PATH;
    if (path.resolve(target) === path.resolve(DEFAULT_SOCKET_PATH)) {
      const installation = await RuntimeInstallation.openReadOnly();
      try { await assertOrdinaryRecoveryAllowed(installation?.activation()); }
      finally { await installation?.close(); }
    }
    const run = () => replaceBackend(path.resolve(directory), { checkOnly: options.check === true, progress: emitStep,
      ...(admission && { admission }), ...(options.schemaPlan ? { schemaPlan: path.resolve(options.schemaPlan) } : {}) });
    // The native fleet command bounds this child to 150s. Retry only its
    // read-only preflight. Never resubmit an activation after a lost reply.
    const result = options.check ? await observeRuntimeUntil(async () => {
      try { return await run(); }
      catch (error) {
        if (error instanceof RuntimeObservationPending) throw error;
        if (error instanceof Error && (isRequestTimeout(error) || error.message === 'Execution mutations have not settled'))
          throw new RuntimeObservationPending('controller', error.message);
        throw error;
      }
    }, 120_000, 'Backend handoff review did not settle', 1000, emitStep) : await run();
    if (!emitJson(result)) emitInfo('checked' in result ? `Candidate ${result.build.commit} verified; no activation performed`
      : `Backend PID ${result.pid}; execution owner PID ${result.ownerPid} retained; epoch ${result.epoch}`);
  } catch (error) { emitError(error); process.exitCode = 1; }
}

export async function backendRecoverCommand(file?: string, options: { currentState?: boolean; check?: boolean; review?: string } = {}): Promise<void> {
  try {
    if (options.currentState) {
      if (file || Boolean(options.check) === Boolean(options.review))
        throw Error('Choose --current-state --check or --current-state --review <sha256> without a checkpoint argument');
      const installation = options.check ? await RuntimeInstallation.openReadOnly() : await RuntimeInstallation.open(undefined, { existing: true });
      if (!installation) throw Error('No runtime installation exists');
      try {
        const { inspectHeldBackendRecovery, acceptColdBackendRecovery } = await import('../daemon/reviewed-backend-recovery.js');
        if (options.check) {
          const state = await inspectHeldBackendRecovery(installation);
          if (!state.currentStateReview) throw Error('A current-state review requires the admitted grant, matching catalogue and a provably dead backend');
          if (!emitJson(state)) emitInfo(`Current-state review ${state.currentStateReview}; controller epoch ${state.admittedEpoch}. Applying requires a clean, stopped owner and guardian. The historical interval remains unverified.`);
        } else {
          const decision = await acceptColdBackendRecovery(installation, options.review!);
          if (!emitJson(decision)) emitInfo(`Cold recovery recorded for epoch ${decision.epoch}. The previous startup runtime remains selected.`);
        }
      } finally { await installation.close(); }
      return;
    }
    if (options.check || options.review) throw Error('--check and --review require --current-state');
    const config = { ...DEFAULT_DAEMON_CONFIG, ...savedDaemonOverrides(readSavedDaemonConfig()) };
    const result = file ? await recoverBackend(path.resolve(file)) : await recoverBackendAfterCrash(executionDirectory(config));
    if (!emitJson(result)) emitInfo(`Backend recovered as PID ${result.pid}; execution owner ${result.ownerPid}`);
  } catch (error) { emitError(error); process.exitCode = 1; }
}

export async function backendAbortCommand(file: string): Promise<void> {
  try {
    await abortBackendReplacement(path.resolve(file));
    if (!emitJson({ aborted: true })) emitInfo('Preparation cancelled; the original backend has resumed');
  } catch (error) { emitError(error); process.exitCode = 1; }
}
