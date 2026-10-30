import path from 'node:path';
import fs from 'node:fs/promises';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { BackendRpcService } from '../daemon/backend.rpc-service.js';
import { replaceBackend, recoverBackend, abortBackendReplacement } from '../daemon/backend-upgrade.js';
import { emitJson, emitError, emitInfo, emitStep } from './output.js';
import { RuntimeInstallation } from '../daemon/runtime-installation.js';
import { PidManager } from '../daemon/pid-manager.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { expandPath } from '../shared/paths.js';
import { executionDirectory } from '../daemon/execution-launcher.js';
import { readSavedDaemonConfig, savedDaemonOverrides } from './up.js';
import { checkBackendCandidate } from '../daemon/backend-candidate.js';
import { recoverBackendAfterCrash } from '../daemon/backend-crash-recovery.js';

export async function backendSupervisorPrepareCommand(directory: string): Promise<void> {
  try {
    const { prepareSupervisorTransition } = await import('../daemon/supervisor-transition.js');
    const result = await prepareSupervisorTransition(path.resolve(directory));
    if (!emitJson(result)) {
      emitInfo(`Guardian plan: ${result.file}`);
      emitInfo(`Owner PID ${result.plan.ownerPid} and the selected backend release will be preserved.`);
    }
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
}

export async function backendSupervisorApplyCommand(file: string): Promise<void> {
  try {
    const { applySupervisorTransition } = await import('../daemon/supervisor-transition.js');
    const result = await applySupervisorTransition(path.resolve(file));
    if (!emitJson(result)) emitInfo(`Guardian PID ${result.result?.guardianPid}; backend PID ${result.result?.backendPid}; execution owner PID ${result.ownerPid} preserved`);
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
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
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
  finally { await installation?.close(); }
}

export async function backendInstallationCommand(): Promise<void> {
  let installation: RuntimeInstallation | null = null;
  try {
    installation = await RuntimeInstallation.open(undefined, { existing: true });
    const state = { directory: installation?.directory ?? null, selection: installation?.selection() ?? null,
      activation: installation?.activation() ?? null };
    if (!emitJson(state)) {
      emitInfo(state.selection ? `Cold-start runtime: ${state.selection.current} (revision ${state.selection.revision})` : 'No runtime is selected for cold start');
      if (state.directory) emitInfo(`Installation: ${state.directory}`);
      if (state.activation) emitInfo(`Unfinished activation: ${state.activation.checkpoint}`);
    }
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
  finally { await installation?.close(); }
}

export async function backendSelectCommand(id: string): Promise<void> {
  let installation: RuntimeInstallation | null = null;
  try {
    installation = await RuntimeInstallation.open();
    if (!installation) throw new Error('Cannot open runtime installation');
    const result = await installation.exclusive(async () => {
      const config = { ...DEFAULT_DAEMON_CONFIG, ...savedDaemonOverrides(readSavedDaemonConfig()) };
      if (new PidManager(expandPath(config.pidFile)).isRunning() ||
          new PidManager(path.join(executionDirectory(config), 'owner.pid')).isRunning()) {
        throw new Error('A backend or execution owner is running; use backend upgrade to retain application ownership');
      }
      if (installation!.activation()) throw new Error('An activation is unfinished; recover or abort its checkpoint before selecting another release');
      const selected = installation!.selection();
      const artifact = await installation!.artifact(id);
      if (!selected?.bootstrap) {
        try { await fs.access(path.join(artifact.directory, 'cli/installed.js')); }
        catch { throw new Error('This release predates managed installation. Select a management-capable release first so rollback and recovery remain available.'); }
      }
      if (selected) {
        const previous = await installation!.artifact(selected.current);
        await checkBackendCandidate(artifact.directory, previous.entry);
      }
      const selection = await installation!.select(id, selected?.revision ?? 0);
      const launcher = await installation!.writeLauncher();
      return { selection, launcher };
    });
    if (!emitJson(result)) emitInfo(`Selected ${id}. Launch with ${result.launcher} up`);
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
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
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
  finally { await client.disconnect(); }
}

export async function backendUpgradeCommand(directory: string, options: { check?: boolean }): Promise<void> {
  try {
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
    const result = await replaceBackend(path.resolve(directory), { checkOnly: options.check === true, progress: emitStep });
    if (!emitJson(result)) emitInfo('checked' in result ? `Candidate ${result.build.commit} verified; no activation performed`
      : `Backend PID ${result.pid}; execution owner PID ${result.ownerPid} retained; epoch ${result.epoch}`);
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
}

export async function backendRecoverCommand(file?: string): Promise<void> {
  try {
    const config = { ...DEFAULT_DAEMON_CONFIG, ...savedDaemonOverrides(readSavedDaemonConfig()) };
    const result = file ? await recoverBackend(path.resolve(file)) : await recoverBackendAfterCrash(executionDirectory(config));
    if (!emitJson(result)) emitInfo(`Backend recovered as PID ${result.pid}; execution owner ${result.ownerPid}`);
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
}

export async function backendAbortCommand(file: string): Promise<void> {
  try {
    await abortBackendReplacement(path.resolve(file));
    if (!emitJson({ aborted: true })) emitInfo('Preparation cancelled; the original backend has resumed');
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
}
