import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { OMNITRON_HOME, DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { RuntimeInstallation } from '../daemon/runtime-installation.js';
import { assertExecutionCapabilities } from '../daemon/execution-capabilities.js';
import { PidManager } from '../daemon/pid-manager.js';
import { executionDirectory } from '../daemon/execution-launcher.js';
import { writePrivateRecord, writePrivateFile } from '../daemon/execution-journal.js';
import { assertManagedRuntime, readManagedRuntimeRecord, managedRuntimeFile, type ManagedRuntime } from '../daemon/managed-runtime.js';
import { BackendRecoveryJournal } from '../daemon/backend-recovery-journal.js';
import { expandPath } from '../shared/paths.js';
import { readSavedDaemonConfig, savedDaemonOverrides } from '../config/saved.js';
import { LAUNCHD_LABEL, SYSTEMD_UNIT, OWNER_LAUNCHD_LABEL, OWNER_SYSTEMD_UNIT,
  renderLaunchdPlist, renderSystemdUnit, unitPathFor, type UnitInputs } from './service-units.js';

export interface ResidentServiceInputs extends UnitInputs {
  /** Installed sealed owner artifact; the guardian/backend remains the selected runtime. */
  readonly ownerRuntime?: string;
  /** Bounded wait for the live backend's durable recovery checkpoint. Zero means inspect once. */
  readonly recoveryWaitMs?: number;
}

class RecoveryCheckpointPending extends Error {}

interface PreparedResidentService {
  config: ManagedRuntime;
  planDirectory: string;
  ownerUnit: string;
  backendUnit: string;
  ownerPath: string;
  backendPath: string;
  backendRunning: boolean;
  ownerRunning: boolean;
}

/** Preparation never stops a backend, replaces an owner, or loads OS jobs. */
export async function prepareResidentService(inputs: ResidentServiceInputs): Promise<PreparedResidentService> {
  return withPreparedService(inputs, 'prepare', async plan => plan);
}

// Keep the same installation lease across validation, plan publication and the
// optional active writes. Another runtime selection cannot invalidate this plan.
async function withPreparedService<T>(inputs: ResidentServiceInputs, mode: 'prepare' | 'install', finish: (plan: PreparedResidentService) => Promise<T>): Promise<T> {
  if (inputs.scope === 'system' && (!inputs.identity || inputs.identity.user === 'root')) {
    throw new Error('Prepare system supervision as the non-root instance owner with service install --scope system --prepare, then install the reviewed unit files with administrative privileges.');
  }
  const installation = await RuntimeInstallation.open(undefined, { existing: true });
  if (!installation) throw new Error('Install and select a sealed runtime before independent supervision');
  const waitMs = inputs.recoveryWaitMs ?? 15_000;
  if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 60_000) {
    await installation.close();
    throw new Error('Recovery checkpoint wait must be between 0 and 60000 milliseconds');
  }
  const deadline = performance.now() + waitMs;
  const prepare = () => installation.exclusive(async () => {
    if (installation.activation()) throw new Error('Finish the pending backend activation before preparing services');
    const selection = installation.selection();
    if (!selection) throw new Error('No runtime has been selected');
    const artifact = await installation.artifact(selection.current);
    const ownerHash = inputs.ownerRuntime ?? selection.current;
    // artifact() verifies installed membership, sealed bytes and native compatibility
    // before any role-specific code or service plan can be admitted.
    const ownerArtifact = ownerHash === selection.current ? artifact : await installation.artifact(ownerHash);
    const entry = path.join(artifact.directory, 'daemon/managed-entry.js');
    const ownerEntry = path.join(ownerArtifact.directory, 'daemon/managed-entry.js');
    await fs.access(entry);
    await fs.access(ownerEntry);
    const ownerModule = await import(pathToFileURL(path.join(ownerArtifact.directory, 'daemon/execution-capabilities.js')).href);
    if (ownerModule.OWNER_CAPABILITIES === undefined) throw new Error('The selected owner runtime has no execution capability declaration');
    assertExecutionCapabilities(ownerModule.OWNER_CAPABILITIES, artifact.executionRequirements ?? {});
    const dc = { ...DEFAULT_DAEMON_CONFIG, ...savedDaemonOverrides(readSavedDaemonConfig()) };
    if (!dc.executionHost?.enabled) throw new Error('Independent supervision requires executionHost.enabled');
    const directory = executionDirectory(dc);
    const planDirectory = path.join(installation.directory, 'supervision-plan');
    const backendPid = new PidManager(expandPath(dc.pidFile)).getPid();
    let environment = process.env;
    let preparedEnvironment: Record<string, string> | undefined;
    if (backendPid) {
      const recovery = new BackendRecoveryJournal(directory);
      try {
        const certificate = recovery.read();
        if (certificate?.status !== 'ready' || certificate.record.previousPid !== backendPid) {
          const reason = !certificate ? 'no checkpoint has been published' : certificate.status === 'invalid'
            ? certificate.reason : `checkpoint belongs to backend ${certificate.record.previousPid}, current backend is ${backendPid}`;
          throw new RecoveryCheckpointPending(`A current backend recovery certificate is required: ${reason}. No service files were changed.`);
        }
        if (certificate.record.runtimeHash !== selection.current) throw new Error('Backend recovery certificate does not match the selected runtime; reconcile runtime selection before preparing services');
        environment = certificate.record.environment;
      } finally { await recovery.close(); }
    } else {
      // The prepared environment must survive the initial controlled pause;
      // the shell executing installation may not carry the daemon's secrets.
      const planFile = path.join(planDirectory, 'supervision.json');
      let prepared: ManagedRuntime | null;
      try { prepared = await readManagedRuntimeRecord(planFile, OMNITRON_HOME); }
      catch { throw new Error('Invalid saved service plan; inspect its private record before preparing or installing services'); }
      // A guardian transition may have advanced the installed environment since the last installation plan.
      const installed = mode === 'prepare' ? await readManagedRuntimeRecord(managedRuntimeFile(), OMNITRON_HOME) : null;
      for (const record of [prepared, installed]) {
        if (record && (record.instanceHome !== OMNITRON_HOME || record.directory !== directory || record.scope !== inputs.scope ||
            record.owner.label !== OWNER_LAUNCHD_LABEL || record.owner.unit !== OWNER_SYSTEMD_UNIT ||
            record.backend.label !== LAUNCHD_LABEL || record.backend.unit !== SYSTEMD_UNIT)) {
          throw new Error('Invalid saved service plan instance, directory, scope or native role identity');
        }
      }
      if (prepared) {
        // Explicit preparation can review new sealed role bindings while retaining
        // the paused instance's secrets. Installation must use that reviewed plan.
        if (mode === 'install' && (prepared.owner.artifact !== ownerHash || prepared.backend.artifact !== selection.current)) {
          throw new Error('The saved service plan no longer matches this instance and selected runtime; prepare a matching plan before installation');
        }
      }
      preparedEnvironment = (installed ?? prepared)?.environment;
    }
    const config: ManagedRuntime = { protocol: 1, instanceHome: OMNITRON_HOME, directory,
      scope: inputs.scope, cwd: path.dirname(artifact.directory),
      // Unit files carry only the instance path. Runtime secrets stay in this
      // private record; transient supervisor and child IPC variables stay out.
      // An already reviewed private environment is copied exactly. Filtering it
      // again could silently discard a previously configured application secret.
      environment: preparedEnvironment ? { ...preparedEnvironment } : Object.fromEntries(Object.entries(environment).filter((pair): pair is [string, string] =>
        pair[1] !== undefined && /^(OMNITRON_|LANG$|LC_|PATH$|HOME$|TMPDIR$)/.test(pair[0]))),
      owner: { label: OWNER_LAUNCHD_LABEL, unit: OWNER_SYSTEMD_UNIT, artifact: ownerHash },
      backend: { label: LAUNCHD_LABEL, unit: SYSTEMD_UNIT, artifact: selection.current },
    };
    config.environment['OMNITRON_HOME'] = OMNITRON_HOME;
    assertManagedRuntime(config, OMNITRON_HOME);
    const base: UnitInputs = { ...inputs, execPath: artifact.execPath, entryPath: entry,
      workdir: path.dirname(artifact.directory), environment: { OMNITRON_HOME }, nodeArgs: [],
    };
    const owner: UnitInputs = { ...base, execPath: ownerArtifact.execPath, entryPath: ownerEntry,
      workdir: path.dirname(ownerArtifact.directory), label: config.owner.label, args: ['owner'], restart: false, forceKill: false,
      stderrLog: path.join(directory, 'owner-service.log') };
    const backend: UnitInputs = { ...base, label: config.backend.label, args: ['backend'],
      stderrLog: path.join(directory, 'supervisor.log') };
    const render = process.platform === 'darwin' ? renderLaunchdPlist : renderSystemdUnit;
    await writePrivateRecord(path.join(planDirectory, 'supervision.json'), config);
    await writePrivateFile(path.join(planDirectory, 'owner.unit'), render(owner));
    await writePrivateFile(path.join(planDirectory, 'backend.unit'), render(backend));
    return finish({ config, planDirectory, ownerUnit: render(owner), backendUnit: render(backend),
      ownerPath: unitPathFor(process.platform, inputs.scope, os.homedir(), true),
      backendPath: unitPathFor(process.platform, inputs.scope, os.homedir()),
      backendRunning: new PidManager(expandPath(dc.pidFile)).isRunning(),
      ownerRunning: new PidManager(path.join(directory, 'owner.pid')).isRunning(),
    });
  });
  try {
    for (;;) {
      try { return await prepare(); }
      catch (error) {
        if (!(error instanceof RecoveryCheckpointPending) || performance.now() >= deadline) throw error;
        // The publisher may need this installation lease. Never wait while holding
        // it, and rerun every admission check before writing the eventual plan.
        await delay(Math.min(250, Math.max(0, deadline - performance.now())));
      }
    }
  } finally { await installation.close(); }
}

/** PID absence does not mean an OS supervisor has relinquished a restartable job. */
export function assertResidentServicesStopped(scope: UnitInputs['scope'], platform: NodeJS.Platform = process.platform): void {
  const options = { encoding: 'utf8' as const, timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' } };
  if (platform === 'darwin') {
    const domain = scope === 'system' ? 'system' : `gui/${process.getuid?.()}`;
    for (const label of [OWNER_LAUNCHD_LABEL, LAUNCHD_LABEL]) {
      try { execFileSync('/bin/launchctl', ['print', `${domain}/${label}`], options); }
      catch (error) {
        const failure = error as { status?: number; stderr?: string | Buffer };
        // launchctl's specific absent-service response; permissions, missing
        // domains, timeouts and other query failures do not establish absence.
        if (failure.status === 113 && String(failure.stderr).split('\n').some(line =>
          line.startsWith(`Could not find service "${label}" in domain `))) continue;
        throw new Error('Cannot establish stopped native services; inspect launchd before installation', { cause: error });
      }
      throw new Error(`Unload native service ${label} before installation; PID absence is insufficient`);
    }
    return;
  }
  if (platform !== 'linux') throw new Error('Native resident supervision is unsupported on this platform');
  for (const unit of [OWNER_SYSTEMD_UNIT, SYSTEMD_UNIT]) {
    let output: string;
    try {
      output = execFileSync('systemctl', [...(scope === 'user' ? ['--user'] : []), 'show', '--all',
        '--property=LoadState,ActiveState,SubState,Job,MainPID', unit], options);
    } catch (error) { throw new Error('Cannot establish stopped native services; inspect systemd before installation', { cause: error }); }
    const lines = output.trim().split('\n');
    const properties = new Map(lines.map(line => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)] as const;
    }));
    if (lines.length !== 5 || properties.size !== 5 ||
        !['loaded', 'not-found'].includes(properties.get('LoadState') ?? '') ||
        properties.get('ActiveState') !== 'inactive' || properties.get('SubState') !== 'dead' ||
        properties.get('Job') !== '' || properties.get('MainPID') !== '0') {
      throw new Error(`Stop native service ${unit} and wait for queued jobs before installation`);
    }
  }
}

export async function installResidentService(inputs: ResidentServiceInputs): Promise<string> {
  return withPreparedService(inputs, 'install', async plan => {
    if (plan.backendRunning || plan.ownerRunning) throw new Error(`Independent owner supervision requires a controlled initial shutdown. Review ${plan.planDirectory}; running applications were not stopped.`);
    // Refuse scope overlap before writing anything active.
    const other = inputs.scope === 'user' ? 'system' : 'user';
    for (const owner of [false, true]) {
      try { await fs.access(unitPathFor(process.platform, other, os.homedir(), owner)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      throw new Error('Remove the other service scope before installing independent supervision');
    }
    assertResidentServicesStopped(inputs.scope);
    // Recheck live PID evidence after the OS query, still under the same lease.
    const dc = { ...DEFAULT_DAEMON_CONFIG, ...savedDaemonOverrides(readSavedDaemonConfig()) };
    if (new PidManager(expandPath(dc.pidFile)).isRunning() ||
        new PidManager(path.join(plan.config.directory, 'owner.pid')).isRunning()) {
      throw new Error('Resident processes appeared during service installation; no active files were written');
    }
    await fs.mkdir(plan.config.directory, { recursive: true, mode: 0o700 });
    await writePrivateRecord(managedRuntimeFile(), plan.config);
    for (const [target, contents] of [[plan.ownerPath, plan.ownerUnit], [plan.backendPath, plan.backendUnit]] as const) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents, { mode: 0o644 });
    }
    return plan.planDirectory;
  });
}
