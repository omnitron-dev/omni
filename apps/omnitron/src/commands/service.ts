import { OMNITRON_HOME, instanceLifecycleSocket } from '../config/defaults.js';
/**
 * omnitron service install|uninstall|status — OS-level daemon supervision.
 *
 * Closes the last supervision gap: omnitron supervises apps and infra, but
 * nothing supervised the daemon itself — a daemon crash (disk-full, load
 * spike, dockerd hiccup) left every managed app down until a human ran
 * `omnitron up`. This registers the daemon with the OS supervisor so it is
 * resurrected automatically:
 *
 *   - macOS: LaunchAgent (~/Library/LaunchAgents/dev.omnitron.daemon.plist)
 *   - Linux: systemd user unit (~/.config/systemd/user/omnitron-daemon.service)
 *
 * Layering stays intact — the OS owns the daemon lifecycle, the daemon owns
 * app/stack lifecycle (boot-time stack resume via project enabledStacks).
 *
 * Restart semantics are crash-only (`KeepAlive={SuccessfulExit:false}` /
 * `Restart=on-failure`): a graceful `omnitron down` exits 0 and STAYS down;
 * a crash or SIGKILL exits abnormally and is respawned. This keeps the
 * existing up/down semantics working unchanged with the service installed.
 *
 * The supervisor execs the same dist/daemon/daemon-entry.js that `omnitron
 * up` forks — one daemon codepath, two launchers. daemon-entry carries a
 * single-instance pid guard so the two launchers can never double-bind.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { log } from '@xec-sh/kit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  renderLaunchdPlist,
  renderSystemdUnit,
  decideScope,
} from './service-units.js';
import type { ServiceScope } from '../shared/dto/runtime-update.js';
import { managedRuntimeFile, managedSupervisorSocket } from '../daemon/managed-runtime.js';
import { privateControlClient } from '../daemon/private-control-client.js';
import { installTargets, launchctl, nativeDomain, nativeLoaded, serviceInventory, systemctl, unchangedJob, type NativeService } from './service-registration.js';
import { randomUUID } from 'node:crypto';
import type { BackendSupervisorService } from '../daemon/backend-supervisor.js';

/** Collect the facts the renderers need from this process. */
function unitInputs(scope: ServiceScope, identity?: { user: string; home: string }): Parameters<typeof renderSystemdUnit>[0] {
  return {
    scope,
    execPath: process.execPath,
    entryPath: path.join(serviceWorkdir(), 'dist/daemon/daemon-entry.js'),
    environment: { OMNITRON_HOME, OMNITRON_SOCKET: instanceLifecycleSocket() },
    workdir: serviceWorkdir(),
    path: servicePath(),
    stderrLog: path.join(logsDir(), process.platform === 'darwin' ? 'launchd.err.log' : 'systemd.err.log'),
    ...(scope === 'system'
      ? { identity: identity ?? { user: os.userInfo().username, home: os.userInfo().homedir } }
      : {}),
  };
}

/**
 * Whether this account's user services survive its last session ending.
 *
 * `loginctl enable-linger` is what turns that on, and the previous version of
 * `serviceInstall` printed it as a tip. A tip changes nothing; this reads the
 * actual state so a decision can be made on it.
 */
function lingerEnabled(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const out = execFileSync('loginctl', ['show-user', os.userInfo().username, '-p', 'Linger'], {
      encoding: 'utf8',
    });
    return out.trim() === 'Linger=yes';
  } catch {
    // No loginctl, or no such user session — either way, not proven true.
    return false;
  }
}

/**
 * Working directory for the supervised daemon. `path.resolve(__dirname,
 * '../..')` = the omnitron package root. Two properties matter:
 *   1. No omnitron.config.ts lives there, so daemon-entry's autoDetect()
 *      cannot re-register the directory as a phantom project (the daemon
 *      resolves its project from the registry instead).
 *   2. `--import tsx/esm` resolves from here upward through node_modules —
 *      needed because project configs are TypeScript.
 *
 * The second point used to end "which the package's install tree provides",
 * and that was an assertion rather than a fact. `tsx` was a devDependency,
 * which npm does not install for a published package, so on a node prepared
 * from the registry the tree provided nothing. Measured there:
 * `import('tsx')` → ERR_MODULE_NOT_FOUND. The unit this function's callers
 * write would have failed at install and at every boot after it, with an
 * ExecStart naming a loader that is not there.
 *
 * It is a runtime dependency now. Nothing in this file could have caught
 * that: `tsx` is never imported, only named in an argv, so the scanners that
 * read import specifiers cannot see it — which is why
 * `a-dependency-the-package-does-not-declare.test.ts` checks `--import`
 * flags separately.
 */
function serviceWorkdir(): string {
  return path.resolve(__dirname, '../..');
}

/**
 * PATH for the supervised daemon. launchd/systemd give services a minimal
 * PATH (/usr/bin:/bin) — but the daemon shells out to `docker` for infra
 * provisioning, so resolve the directories of node and docker at install
 * time and bake them in.
 */
function servicePath(): string {
  const dirs = new Set<string>();
  dirs.add(path.dirname(process.execPath));
  try {
    const docker = execFileSync('/bin/sh', ['-lc', 'command -v docker'], { encoding: 'utf8' }).trim();
    if (docker) dirs.add(path.dirname(docker));
  } catch {
    // docker not found now — the standard locations below still cover
    // a later install.
  }
  for (const d of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']) {
    dirs.add(d);
  }
  return Array.from(dirs).join(':');
}

function logsDir(): string {
  const dir = path.join(OMNITRON_HOME, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function installedService(): NativeService | null {
  return serviceInventory().owned;
}

function checkedJobs(service: NativeService) {
  // Check both roles before the first effect. A guardian match cannot authorize a different owner.
  return service.jobs.map(job => ({ job, loaded: nativeLoaded(job) }));
}

export function serviceBootout(service: NativeService): void {
  for (const { job, loaded } of checkedJobs(service).reverse()) {
    unchangedJob(job);
    if (process.platform === 'darwin') {
      if (loaded) launchctl(['bootout', nativeDomain(service.scope) + '/' + job.name]);
    } else systemctl(service.scope, ['disable', ...(loaded ? ['--now'] : []), job.name]);
  }
}

export function serviceKickstart(service: NativeService): void {
  for (const { job, loaded } of checkedJobs(service)) {
    unchangedJob(job);
    if (process.platform === 'darwin') {
      const target = nativeDomain(service.scope) + '/' + job.name;
      if (loaded) launchctl(['kickstart', target]);
      else {
        launchctl(['enable', target]);
        launchctl(['bootstrap', nativeDomain(service.scope), job.file]);
      }
    } else {
      if (!loaded) {
        systemctl(service.scope, ['daemon-reload']);
        if (!nativeLoaded(job)) throw Error('Installed systemd unit is unavailable: ' + job.file);
      }
      systemctl(service.scope, ['enable', '--now', job.name]);
    }
  }
}

function removeService(service: NativeService): void {
  serviceBootout(service);
  for (const job of service.jobs) {
    unchangedJob(job);
    fs.unlinkSync(job.file);
  }
  if (process.platform === 'linux') systemctl(service.scope, ['daemon-reload']);
}

function startInstallation(scope: ServiceScope): void {
  const service = installedService();
  if (!service || service.scope !== scope) throw Error('Installed native registration does not match the selected instance');
  if (process.platform === 'linux') systemctl(scope, ['daemon-reload']);
  serviceKickstart(service);
}

export async function serviceInstall(options: { scope?: ServiceScope; prepare?: boolean; ownerRuntime?: string } = {}): Promise<void> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    log.error(`Unsupported platform for service install: ${process.platform}`);
    process.exitCode = 1;
    return;
  }

  // The scope decides whether this survives a logout, which for a slave is
  // the whole point of installing it. See `service-units.ts`.
  const { readSavedDaemonConfig } = await import('../config/saved.js');
  instanceLifecycleSocket();
  const saved = readSavedDaemonConfig();
  if (!saved?.executionHost?.enabled && options.ownerRuntime !== undefined) throw new Error('Owner runtime selection requires independent resident execution');
  if (!saved?.executionHost?.enabled && options.prepare) throw new Error('Service preparation is available for independent resident execution');
  const inventory = options.prepare ? null : serviceInventory();
  const scopeInputs = { requested: options.scope, role: saved?.role, isRoot: options.prepare === true || process.getuid?.() === 0,
    platform: process.platform, lingerEnabled: false };
  let decision = decideScope(scopeInputs);
  if (decision.refusal && process.platform === 'linux') {
    if (inventory?.foreign.some(job => job.scope === 'user')) throw Error('The fallback user service belongs to another instance');
    decision = decideScope({ ...scopeInputs, lingerEnabled: lingerEnabled() });
  }

  if (decision.refusal) {
    // Not a warning beside an install that happened anyway. A slave
    // supervised by something that stops at logout is not supervised, and
    // reporting success for it moves the failure to a later hour and a
    // different machine.
    log.error(decision.refusal);
    process.exitCode = 1;
    return;
  }

  const scope = decision.scope;
  const resident = saved?.executionHost?.enabled === true;
  const targets = inventory ? installTargets(scope, resident, inventory) : [];
  const previous = inventory?.owned;
  if (previous) checkedJobs(previous);
  for (const target of targets) nativeLoaded(target);
  const prior = previous?.jobs.at(-1)?.definition;
  const identity = prior?.account ? { user: prior.account, home: prior.environment['HOME']! } : undefined;
  const ownerUid = fs.statSync(OMNITRON_HOME, { throwIfNoEntry: false })?.uid;
  if (!identity && ownerUid !== undefined && ownerUid !== os.userInfo().uid) {
    throw Error('Prepare native supervision as the owner of the selected OMNITRON_HOME');
  }
  if (resident) {
    const { prepareResidentService, installResidentService } = await import('./service-resident.js');
    const inputs = { ...unitInputs(scope, identity), ...(options.ownerRuntime !== undefined ? { ownerRuntime: options.ownerRuntime } : {}) };
    if (options.prepare) {
      const plan = await prepareResidentService(inputs);
      log.info(`Independent supervision plan: ${plan.planDirectory}`);
      log.info(`Owner: ${plan.ownerPath}\nBackend: ${plan.backendPath}`);
      return;
    }
    if (previous && previous.scope !== scope) throw Error('Uninstall the previous scope before installing independent supervision');
    const plan = await installResidentService(inputs);
    startInstallation(scope);
    log.success(`Independent owner and backend services installed (${scope}). Plan: ${plan}`);
    return;
  }

  if (previous && previous.scope !== scope) removeService(previous);
  else if (previous) serviceBootout(previous);
  const { daemonStop } = await import('./daemon-cmd.js');
  await daemonStop();

  const target = targets[0]!;
  const inputs = unitInputs(scope, identity);
  const contents = process.platform === 'darwin' ? renderLaunchdPlist(inputs) : renderSystemdUnit(inputs);
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  unchangedJob(target);
  if (target.body === null) fs.writeFileSync(target.file, contents, { flag: 'wx', mode: 0o644 });
  else {
    const temp = path.join(path.dirname(target.file), '.omnitron-' + randomUUID());
    fs.writeFileSync(temp, contents, { flag: 'wx', mode: 0o644 });
    try { unchangedJob(target); fs.renameSync(temp, target.file); }
    finally { fs.rmSync(temp, { force: true }); }
  }
  startInstallation(scope);
  log.success(`Installed ${scope} service: ${target.file}`);

  log.info(`  Scope: ${scope} — ${decision.because}.`);
  if (scope === 'system') {
    log.info(`  Runs as: ${inputs.identity!.user}.`);
  }
  log.info('  Crash → auto-restart; `omnitron down` → stays down until `omnitron up`.');
}

export async function serviceUninstall(): Promise<void> {
  const service = installedService();
  if (!service) { log.warn('No native service is registered for this instance.'); return; }
  removeService(service);
  if (service.managed) fs.unlinkSync(managedRuntimeFile());
  log.success(`Removed the ${service.scope} service for ${OMNITRON_HOME}.`);
}

export async function serviceStatus(): Promise<void> {
  const service = installedService();
  if (!service) { log.info('No native service is registered for this instance.'); return; }
  const observed = checkedJobs(service);
  const { scope, managed } = service;
  if (managed) {
    const connection = await privateControlClient<BackendSupervisorService>(managedSupervisorSocket(managed), 'OmnitronSupervisor').catch(() => null);
    if (connection) {
      try {
        const state = await connection.service.status();
        log.info(`Independent supervision: ${state.state}; guardian ${state.pid}; owner ${state.ownerPid ?? 'unavailable'}; backend ${state.backendPid ?? 'unavailable'}`);
        if (state.reason) log.warn(state.reason);
      } finally { await connection.close(); }
    } else log.warn('The backend guardian is unavailable; inspect its OS service and private supervisor.log.');
  }
  for (const { job, loaded } of observed) {
    log.info(`Service: ${scope} scope, ${loaded ? loaded.state : 'unloaded'} (${job.file})`);
    if (loaded && loaded.pid) log.info(`  PID: ${loaded.pid}`);
    if (loaded && loaded.lastExit) log.info(`  Last exit: ${loaded.lastExit}`);
  }
  if (process.platform === 'linux' && scope === 'user' && !lingerEnabled()) {
    log.warn('The user service stops when your last session ends (lingering is off).');
  }
}
