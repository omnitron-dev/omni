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
  LAUNCHD_LABEL,
  SYSTEMD_UNIT,
  unitPathFor,
  renderLaunchdPlist,
  renderSystemdUnit,
  decideScope,
  type ServiceScope,
} from './service-units.js';

/** Collect the facts the renderers need from this process. */
function unitInputs(scope: ServiceScope): Parameters<typeof renderSystemdUnit>[0] {
  return {
    scope,
    execPath: process.execPath,
    entryPath: daemonEntryPath(),
    workdir: serviceWorkdir(),
    path: servicePath(),
    stderrLog: path.join(logsDir(), process.platform === 'darwin' ? 'launchd.err.log' : 'systemd.err.log'),
    ...(scope === 'system'
      ? { identity: { user: os.userInfo().username, home: os.homedir() } }
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

function launchdPlistPath(scope: ServiceScope = 'user'): string {
  return unitPathFor('darwin', scope, os.homedir());
}

function systemdUnitPath(scope: ServiceScope = 'user'): string {
  return unitPathFor('linux', scope, os.homedir());
}

/** True when the current platform's service definition file exists. */
export function isServiceInstalled(): boolean {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return false;
  // Either scope counts. A machine with a system unit and a user that never
  // installed one still has a supervised daemon, and the callers of this —
  // `omnitron up`, the uninstall path — need to know that.
  return (['system', 'user'] as const).some((scope) =>
    fs.existsSync(unitPathFor(process.platform, scope, os.homedir())),
  );
}

/**
 * The daemon entry the supervisor execs — same file `omnitron up` forks
 * (dist/commands → ../daemon/daemon-entry.js), so both launchers run the
 * identical daemon.
 */
function daemonEntryPath(): string {
  return path.resolve(__dirname, '../daemon/daemon-entry.js');
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
  const dir = path.join(os.homedir(), '.omnitron', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function launchctl(args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync('launchctl', args, { encoding: 'utf8' });
  } catch (err) {
    if (opts.allowFail) return '';
    throw err;
  }
}

/**
 * `systemctl`, for the scope being operated on.
 *
 * `--user` and no flag address two different registries: a unit installed in
 * `/etc/systemd/system` is invisible to `systemctl --user`, and the reverse.
 * Getting this wrong does not error — it reports "unit not found" for a unit
 * that is there, in the other one.
 */
function systemctl(scope: ServiceScope, args: string[], opts: { allowFail?: boolean } = {}): string {
  const scoped = scope === 'system' ? args : ['--user', ...args];
  try {
    return execFileSync('systemctl', scoped, { encoding: 'utf8' });
  } catch (err) {
    if (opts.allowFail) return '';
    throw err;
  }
}

/**
 * launchd's domain for a scope: the login session, or the machine.
 *
 * `system` is where a LaunchDaemon lives and is the only domain that exists
 * before anybody logs in.
 */
function domain(scope: ServiceScope): string {
  return scope === 'system' ? 'system' : `gui/${process.getuid?.() ?? 501}`;
}

/**
 * The scope actually installed on this machine, for the callers that operate
 * on whatever is there — `serviceKickstart` after a `daemon down`, and the
 * uninstall path. Defaults to `user` when nothing is installed, which is what
 * the pre-scope code always assumed.
 */
function currentScope(): ServiceScope {
  return fs.existsSync(unitPathFor(process.platform, 'system', os.homedir())) ? 'system' : 'user';
}

/** Load (or reload) the service with the supervisor and start it. */
export function serviceBootstrap(scope: ServiceScope = currentScope()): void {
  if (process.platform === 'darwin') {
    // bootout first so a re-install picks up a rewritten plist; ignore
    // "not loaded" failures.
    launchctl(['bootout', `${domain(scope)}/${LAUNCHD_LABEL}`], { allowFail: true });
    launchctl(['bootstrap', domain(scope), launchdPlistPath(scope)]);
    launchctl(['enable', `${domain(scope)}/${LAUNCHD_LABEL}`], { allowFail: true });
  } else if (process.platform === 'linux') {
    systemctl(scope, ['daemon-reload']);
    systemctl(scope, ['enable', '--now', SYSTEMD_UNIT]);
  }
}

/** Unload the service (stops the daemon via supervisor SIGTERM). */
export function serviceBootout(scope: ServiceScope = currentScope()): void {
  if (process.platform === 'darwin') {
    launchctl(['bootout', `${domain(scope)}/${LAUNCHD_LABEL}`], { allowFail: true });
  } else if (process.platform === 'linux') {
    systemctl(scope, ['disable', '--now', SYSTEMD_UNIT], { allowFail: true });
  }
}

/** Ask the supervisor to start the (already loaded) service now. */
export function serviceKickstart(scope: ServiceScope = currentScope()): void {
  if (process.platform === 'darwin') {
    // If a previous bootout unloaded the job, bootstrap it back first.
    const loaded = launchctl(['print', `${domain(scope)}/${LAUNCHD_LABEL}`], { allowFail: true });
    if (!loaded) {
      launchctl(['bootstrap', domain(scope), launchdPlistPath(scope)]);
      launchctl(['enable', `${domain(scope)}/${LAUNCHD_LABEL}`], { allowFail: true });
      return; // RunAtLoad starts it
    }
    launchctl(['kickstart', `${domain(scope)}/${LAUNCHD_LABEL}`], { allowFail: true });
  } else if (process.platform === 'linux') {
    systemctl(scope, ['start', SYSTEMD_UNIT]);
  }
}

export async function serviceInstall(options: { scope?: ServiceScope } = {}): Promise<void> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    log.error(`Unsupported platform for service install: ${process.platform}`);
    process.exitCode = 1;
    return;
  }

  // The scope decides whether this survives a logout, which for a slave is
  // the whole point of installing it. See `service-units.ts`.
  const { readSavedDaemonConfig } = await import('./up.js');
  const decision = decideScope({
    requested: options.scope,
    role: readSavedDaemonConfig()?.role,
    isRoot: process.getuid?.() === 0,
    lingerEnabled: lingerEnabled(),
    platform: process.platform,
  });

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

  // Stop a manually-started daemon first so the supervised one can bind
  // the socket immediately (daemon-entry's pid guard would otherwise make
  // the service exit until the foreign daemon dies).
  const { daemonStop } = await import('./daemon-cmd.js');
  await daemonStop().catch(() => { /* not running — fine */ });

  // A scope change leaves the other scope's definition behind, and two
  // supervisors racing for one socket is worse than either alone.
  removeOtherScope(scope);

  const inputs = unitInputs(scope);
  if (process.platform === 'darwin') {
    const plist = launchdPlistPath(scope);
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, renderLaunchdPlist(inputs));
    serviceBootstrap(scope);
    log.success(`${scope === 'system' ? 'LaunchDaemon' : 'LaunchAgent'} installed: ${plist}`);
    log.info(`  Label: ${LAUNCHD_LABEL} (KeepAlive on crash, RunAtLoad at boot)`);
  } else {
    const unit = systemdUnitPath(scope);
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    fs.writeFileSync(unit, renderSystemdUnit(inputs));
    serviceBootstrap(scope);
    log.success(`systemd ${scope} unit installed: ${unit}`);
    log.info(`  Unit: ${SYSTEMD_UNIT} (Restart=on-failure)`);
  }

  log.info(`  Scope: ${scope} — ${decision.because}.`);
  if (scope === 'system') {
    log.info(`  Runs as: ${os.userInfo().username} (root installs the unit; root does not run the daemon).`);
  }
  log.info('  Crash → auto-restart; `omnitron down` → stays down until `omnitron up`.');
}

/**
 * Remove the definition for the scope we are NOT installing.
 *
 * Switching a node from user to system supervision otherwise leaves both on
 * disk: the old one still enabled, the new one starting at boot, and both
 * trying to bind one unix socket. The pid guard in `daemon-entry` makes that
 * survivable and unexplainable — one of them exits immediately, for ever,
 * and which one depends on the order they start.
 */
function removeOtherScope(keeping: ServiceScope): void {
  const other: ServiceScope = keeping === 'system' ? 'user' : 'system';
  const otherPath = unitPathFor(process.platform, other, os.homedir());
  if (!fs.existsSync(otherPath)) return;
  try {
    serviceBootout(other);
    fs.rmSync(otherPath, { force: true });
    log.info(`  Removed the previous ${other} definition: ${otherPath}`);
  } catch (err) {
    // Reported, not fatal: an operator who cannot remove the old one still
    // needs to know it is there.
    log.warn(`  Could not remove the previous ${other} definition at ${otherPath}: ${(err as Error).message}`);
  }
}

export async function serviceUninstall(): Promise<void> {
  if (!isServiceInstalled()) {
    log.warn('Service is not installed.');
    return;
  }
  // Both scopes, not just the one this process would install. An uninstall
  // that leaves the other definition on disk is how a machine ends up with a
  // daemon nobody asked for starting at boot.
  for (const scope of ['system', 'user'] as const) {
    const unitPath = unitPathFor(process.platform, scope, os.homedir());
    if (!fs.existsSync(unitPath)) continue;
    try {
      serviceBootout(scope);
      if (process.platform === 'linux') systemctl(scope, ['daemon-reload'], { allowFail: true });
      fs.rmSync(unitPath, { force: true });
      log.success(`Removed the ${scope} service definition: ${unitPath}`);
    } catch (err) {
      log.error(`Could not remove ${unitPath}: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
  log.info('  Use `omnitron up` to run the daemon unsupervised again.');
}

export async function serviceStatus(): Promise<void> {
  if (!isServiceInstalled()) {
    log.info('Service: not installed. Run `omnitron service install` to supervise the daemon.');
    return;
  }
  const scope = currentScope();
  if (process.platform === 'darwin') {
    log.info(`Service: installed, ${scope} scope (${launchdPlistPath(scope)})`);
    const out = launchctl(['print', `${domain(scope)}/${LAUNCHD_LABEL}`], { allowFail: true });
    if (!out) {
      log.warn('  State: not loaded (boot it with `omnitron up` or `launchctl bootstrap`)');
      return;
    }
    const state = out.match(/state = (.+)/)?.[1]?.trim();
    const pid = out.match(/pid = (\d+)/)?.[1];
    const lastExit = out.match(/last exit code = (.+)/)?.[1]?.trim();
    log.info(`  State: ${state ?? 'unknown'}${pid ? ` (PID: ${pid})` : ''}`);
    if (lastExit && lastExit !== '(never exited)') log.info(`  Last exit: ${lastExit}`);
  } else {
    log.info(`Service: installed, ${scope} scope (${systemdUnitPath(scope)})`);
    const out = systemctl(scope, ['status', '--no-pager', SYSTEMD_UNIT], { allowFail: true });
    log.info(out.split('\n').slice(0, 5).map((l: string) => `  ${l}`).join('\n'));
    if (scope === 'user' && !lingerEnabled()) {
      // Said where it is true, rather than as a tip beside every install: a
      // user unit without lingering stops when the last session ends.
      log.warn('  This unit stops when your last session ends (lingering is off for this account).');
    }
  }
}
