import path from 'node:path';
import fs from 'node:fs/promises';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { BackendRpcService } from '../daemon/backend.rpc-service.js';
import { replaceBackend, recoverBackend, abortBackendReplacement } from '../daemon/backend-upgrade.js';
import { emitJson, emitError, emitInfo, emitStep } from './output.js';
import { RuntimeInstallation, assertOrdinaryRecoveryAllowed } from '../daemon/runtime-installation.js';
import { PidManager } from '../daemon/pid-manager.js';
import { DEFAULT_DAEMON_CONFIG, DEFAULT_SOCKET_PATH } from '../config/defaults.js';
import { getEnv } from '../shared/env-config.js';
import { expandPath } from '../shared/paths.js';
import { executionDirectory } from '../daemon/execution-launcher.js';
import { readSavedDaemonConfig, savedDaemonOverrides } from '../config/saved.js';
import { assertBackendMigrationsCompatible, backendSchemaScope } from '../daemon/backend-candidate.js';
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

export async function backendSelectCommand(id: string, checkOnly = false): Promise<void> {
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
      if (!selected?.bootstrap) {
        try { await fs.access(path.join(artifact.directory, 'cli/installed.js')); }
        catch { throw new Error('This release predates managed installation. Select a management-capable release first so rollback and recovery remain available.'); }
      }
      // Managed cold startup reads this instance's persisted role. Other launch
      // modes may override it and must retain the conservative comparison.
      const scope = backendSchemaScope(config) === 'node' && await readManagedRuntime(registry.home) ? 'node' : 'all';
      if (selected) {
        const previous = await registry.artifact(selected.current);
        await assertBackendMigrationsCompatible(previous.directory, artifact.directory, scope);
      }
      return { selected, scope, config };
    };
    if (checkOnly) {
      const { selected, scope } = await check();
      const confirmed = registry.settledSelection({ allowEmpty: true });
      if (confirmed?.revision !== selected?.revision || confirmed?.current !== selected?.current) throw new Error('Runtime selection changed during the check');
      if (!emitJson({ checked: true, current: selected?.current ?? null, candidate: id, schemaScope: scope })) {
        emitInfo(`Cold selection verified for ${id} (${scope} migrations).`);
      }
      return;
    }
    const result = await registry.exclusive(async () => {
      const { selected, config } = await check();
      if (new PidManager(expandPath(config.pidFile)).isRunning() ||
          new PidManager(path.join(executionDirectory(config), 'owner.pid')).isRunning()) {
        throw new Error('A backend or execution owner is running; use backend upgrade to retain application ownership');
      }
      const selection = await registry.select(id, selected?.revision ?? 0);
      const launcher = await registry.writeLauncher();
      return { selection, launcher };
    });
    if (!emitJson(result)) emitInfo(`Selected ${id}. Launch with ${result.launcher} up`);
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

export async function backendUpgradeCommand(directory: string, options: { check?: boolean; schemaPlan?: string }): Promise<void> {
  try {
    // A socket chosen for another instance must keep its own RPC authority.
    const target = getEnv().OMNITRON_SOCKET ?? DEFAULT_SOCKET_PATH;
    if (path.resolve(target) === path.resolve(DEFAULT_SOCKET_PATH)) {
      const installation = await RuntimeInstallation.openReadOnly();
      try { assertOrdinaryRecoveryAllowed(installation?.activation()); }
      finally { await installation?.close(); }
    }
    // Legacy versions have no OmnitronBackend service. Ask their stable
    // status first to explain the capability boundary without draining them.
    const client = createDaemonClient();
    try {
      const status = await client.status();
      if (!status.execution?.handoffSupported) throw new Error(status.execution?.reason ??
        'The running daemon directly owns application processes. One initial controlled restart is required to enable resident execution. Nothing was stopped.');
      const backend = await client.service<BackendRpcService>('OmnitronBackend');
      await backend.status();
    } finally { await client.disconnect(); }
    const result = await replaceBackend(path.resolve(directory), { checkOnly: options.check === true, progress: emitStep,
      ...(options.schemaPlan ? { schemaPlan: path.resolve(options.schemaPlan) } : {}) });
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
