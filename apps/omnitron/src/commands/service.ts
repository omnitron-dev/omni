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

const LAUNCHD_LABEL = 'dev.omnitron.daemon';
const SYSTEMD_UNIT = 'omnitron-daemon.service';

function launchdPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

function systemdUnitPath(): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT);
}

/** True when the current platform's service definition file exists. */
export function isServiceInstalled(): boolean {
  if (process.platform === 'darwin') return fs.existsSync(launchdPlistPath());
  if (process.platform === 'linux') return fs.existsSync(systemdUnitPath());
  return false;
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
 *   2. `--import tsx/esm` resolves from here upward through node_modules,
 *      which the package's install tree provides — needed because project
 *      configs are TypeScript.
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

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderLaunchdPlist(): string {
  const workdir = serviceWorkdir();
  const args = [process.execPath, '--import', 'tsx/esm', daemonEntryPath()];
  const argsXml = args.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n');
  // stdout → /dev/null: the daemon already writes (and ROTATES) its own
  // ~/.omnitron/logs/omnitron.log; launchd appends without rotation, and the
  // duplicated stdout stream grew to 1.1GB in under a week. stderr stays on
  // file — it is small and carries the crash forensics (fatal errors,
  // unhandled-rejection safety-net lines) that outlive the daemon's logger.
  const logs = logsDir();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(workdir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OMNITRON_CWD</key>
    <string>${xmlEscape(workdir)}</string>
    <key>PATH</key>
    <string>${xmlEscape(servicePath())}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ExitTimeOut</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logs, 'launchd.err.log'))}</string>
</dict>
</plist>
`;
}

function renderSystemdUnit(): string {
  const workdir = serviceWorkdir();
  const exec = [process.execPath, '--import', 'tsx/esm', daemonEntryPath()]
    .map((a) => (a.includes(' ') ? `"${a}"` : a))
    .join(' ');
  return `[Unit]
Description=Omnitron daemon — process supervisor and control plane
After=network.target docker.service

[Service]
Type=simple
ExecStart=${exec}
WorkingDirectory=${workdir}
Environment=OMNITRON_CWD=${workdir}
Environment=PATH=${servicePath()}
Restart=on-failure
RestartSec=10
TimeoutStopSec=30

[Install]
WantedBy=default.target
`;
}

function launchctl(args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync('launchctl', args, { encoding: 'utf8' });
  } catch (err) {
    if (opts.allowFail) return '';
    throw err;
  }
}

function systemctlUser(args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync('systemctl', ['--user', ...args], { encoding: 'utf8' });
  } catch (err) {
    if (opts.allowFail) return '';
    throw err;
  }
}

function gui(): string {
  return `gui/${process.getuid?.() ?? 501}`;
}

/** Load (or reload) the service with the supervisor and start it. */
export function serviceBootstrap(): void {
  if (process.platform === 'darwin') {
    // bootout first so a re-install picks up a rewritten plist; ignore
    // "not loaded" failures.
    launchctl(['bootout', `${gui()}/${LAUNCHD_LABEL}`], { allowFail: true });
    launchctl(['bootstrap', gui(), launchdPlistPath()]);
    launchctl(['enable', `${gui()}/${LAUNCHD_LABEL}`], { allowFail: true });
  } else if (process.platform === 'linux') {
    systemctlUser(['daemon-reload']);
    systemctlUser(['enable', '--now', SYSTEMD_UNIT]);
  }
}

/** Unload the service (stops the daemon via supervisor SIGTERM). */
export function serviceBootout(): void {
  if (process.platform === 'darwin') {
    launchctl(['bootout', `${gui()}/${LAUNCHD_LABEL}`], { allowFail: true });
  } else if (process.platform === 'linux') {
    systemctlUser(['stop', SYSTEMD_UNIT], { allowFail: true });
  }
}

/** Ask the supervisor to start the (already loaded) service now. */
export function serviceKickstart(): void {
  if (process.platform === 'darwin') {
    // If a previous bootout unloaded the job, bootstrap it back first.
    const loaded = launchctl(['print', `${gui()}/${LAUNCHD_LABEL}`], { allowFail: true });
    if (!loaded) {
      launchctl(['bootstrap', gui(), launchdPlistPath()]);
      launchctl(['enable', `${gui()}/${LAUNCHD_LABEL}`], { allowFail: true });
      return; // RunAtLoad starts it
    }
    launchctl(['kickstart', `${gui()}/${LAUNCHD_LABEL}`], { allowFail: true });
  } else if (process.platform === 'linux') {
    systemctlUser(['start', SYSTEMD_UNIT]);
  }
}

export async function serviceInstall(): Promise<void> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    log.error(`Unsupported platform for service install: ${process.platform}`);
    process.exitCode = 1;
    return;
  }

  // Stop a manually-started daemon first so the supervised one can bind
  // the socket immediately (daemon-entry's pid guard would otherwise make
  // the service exit until the foreign daemon dies).
  const { daemonStop } = await import('./daemon-cmd.js');
  await daemonStop().catch(() => { /* not running — fine */ });

  if (process.platform === 'darwin') {
    const plist = launchdPlistPath();
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, renderLaunchdPlist());
    serviceBootstrap();
    log.success(`LaunchAgent installed: ${plist}`);
    log.info(`  Label: ${LAUNCHD_LABEL} (KeepAlive on crash, RunAtLoad at login)`);
  } else {
    const unit = systemdUnitPath();
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    fs.writeFileSync(unit, renderSystemdUnit());
    serviceBootstrap();
    log.success(`systemd user unit installed: ${unit}`);
    log.info(`  Unit: ${SYSTEMD_UNIT} (Restart=on-failure, enabled at login)`);
    log.info('  Tip: `loginctl enable-linger` keeps it running without an active session.');
  }

  log.info('  Crash → auto-restart; `omnitron down` → stays down until `omnitron up`.');
}

export async function serviceUninstall(): Promise<void> {
  if (!isServiceInstalled()) {
    log.warn('Service is not installed.');
    return;
  }
  serviceBootout();
  if (process.platform === 'darwin') {
    fs.rmSync(launchdPlistPath(), { force: true });
    log.success('LaunchAgent removed (daemon stopped).');
  } else {
    systemctlUser(['disable', SYSTEMD_UNIT], { allowFail: true });
    fs.rmSync(systemdUnitPath(), { force: true });
    systemctlUser(['daemon-reload'], { allowFail: true });
    log.success('systemd user unit removed (daemon stopped).');
  }
  log.info('  Use `omnitron up` to run the daemon unsupervised again.');
}

export async function serviceStatus(): Promise<void> {
  if (!isServiceInstalled()) {
    log.info('Service: not installed. Run `omnitron service install` to supervise the daemon.');
    return;
  }
  if (process.platform === 'darwin') {
    log.info(`Service: installed (${launchdPlistPath()})`);
    const out = launchctl(['print', `${gui()}/${LAUNCHD_LABEL}`], { allowFail: true });
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
    log.info(`Service: installed (${systemdUnitPath()})`);
    const out = systemctlUser(['status', '--no-pager', SYSTEMD_UNIT], { allowFail: true });
    log.info(out.split('\n').slice(0, 5).map((l) => `  ${l}`).join('\n'));
  }
}
