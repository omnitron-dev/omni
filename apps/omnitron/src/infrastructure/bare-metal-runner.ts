/**
 * Carrying out a bare-metal plan on the host it was planned for.
 *
 * Runs where the service runs — inside the node's own daemon, beside the
 * container reconciler — so there is no second machine's view of the state
 * and no shell quoting between the decision and the act. Every command is
 * an argv array through `execFile`: none of these values is ever spliced
 * into a shell string, because several of them are credentials and one of
 * them is a whole config file.
 *
 * The observation half is here too, because "is it installed" and "is the
 * unit active" are questions only the host can answer, and answering them
 * wrongly is how a reconciler restarts a healthy service.
 */

import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { AdoptionObservation, BareMetalAction, BareMetalObservation, BareMetalSpec } from './bare-metal-plan.js';

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Everything this needs from a host, so a test can be a host. */
export interface HostRunner {
  /** Run argv. Never a shell string. */
  run(argv: readonly string[], options?: { timeoutMs?: number }): Promise<CommandResult>;
  /** Run a command line through a shell — only for operator-declared commands. */
  shell(command: string, options?: { timeoutMs?: number }): Promise<CommandResult>;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string, options: { mode: string; owner?: string | undefined }): Promise<void>;
  exists(path: string): Promise<boolean>;
  /**
   * rename(2): on one filesystem, and never a copy — across two it fails. A
   * directory replaces an empty one at `to`, and never lands inside it.
   */
  rename(from: string, to: string): Promise<void>;
}

export async function observeBareMetal(spec: BareMetalSpec, host: HostRunner): Promise<BareMetalObservation> {
  const [installed, userExists, dataDirExists, unit, configContent] = await Promise.all([
    // No `validateCommand` means "assume present": the declaration did not
    // give a way to check, and guessing "absent" would run an install every
    // pass.
    spec.validateCommand ? host.shell(spec.validateCommand, { timeoutMs: 15_000 }).then((r) => r.ok) : Promise.resolve(true),
    spec.user ? host.run(['id', '-u', spec.user]).then((r) => r.ok) : Promise.resolve(true),
    spec.dataDir ? host.exists(spec.dataDir) : Promise.resolve(true),
    observeUnit(spec.systemdUnit, host),
    spec.configFile ? host.readFile(spec.configFile) : Promise.resolve(null),
  ]);

  const unitPath = spec.systemdUnit ? (spec.unitFile ?? `/etc/systemd/system/${spec.systemdUnit}.service`) : null;
  const unitContent = spec.unitContent !== undefined && unitPath ? await host.readFile(unitPath) : null;
  const adoption =
    spec.adopt && spec.dataDir ? await observeAdoption(spec.adopt, spec.dataDir, spec.configFile, host) : undefined;

  return {
    installed,
    userExists,
    dataDirExists,
    unitKnown: unit.known,
    unitActive: unit.active,
    unitEnabled: unit.enabled,
    configContent,
    unitContent,
    ...(adoption ? { adoption } : {}),
  };
}

/** Both ends of a takeover, whether they share a filesystem, and the unit that ran the chain. */
async function observeAdoption(
  adopt: NonNullable<BareMetalSpec['adopt']>,
  dataDir: string,
  configFile: string | undefined,
  host: HostRunner,
): Promise<AdoptionObservation> {
  // One entry, not a listing: a chain directory holds thousands.
  const holds = (path: string) =>
    host.run(['find', path, '-mindepth', '1', '-maxdepth', '1', '-print', '-quit']).then((r) => r.ok && r.stdout.trim() !== '');
  const device = (path: string) => host.run(['stat', '-c', '%d', path]).then((r) => (r.ok ? r.stdout.trim() : null));
  const config = configFile?.slice(configFile.lastIndexOf('/') + 1);

  const [sourceHeld, targetHeld, fromDevice, toDevice, configBeside, replaced] = await Promise.all([
    holds(adopt.from),
    holds(dataDir),
    device(adopt.from),
    // Where the chain would land: the data directory, which may be a mount
    // of its own, or — not there yet — the directory it goes in.
    device(dataDir).then((d) => d ?? device(dataDir.slice(0, dataDir.lastIndexOf('/')) || '/')),
    config ? host.exists(`${adopt.from}/${config}`) : Promise.resolve(false),
    adopt.replaces ? observeUnit(adopt.replaces, host) : Promise.resolve(null),
  ]);

  return { sourceHeld, targetHeld, sameFilesystem: fromDevice !== null && fromDevice === toDevice, configBeside, replaced };
}

async function observeUnit(
  unit: string | undefined,
  host: HostRunner,
): Promise<{ known: boolean; active: boolean; enabled: boolean }> {
  if (!unit) return { known: false, active: false, enabled: false };

  // One call, three answers. `systemctl show` succeeds for a unit systemd
  // has never heard of and answers `LoadState=not-found`, which is the
  // difference between "not installed" and "installed and stopped" — and
  // `is-active` alone cannot tell them apart.
  const shown = await host.run(['systemctl', 'show', unit, '-p', 'LoadState', '-p', 'ActiveState', '-p', 'UnitFileState']);
  const read = (key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(shown.stdout)?.[1]?.trim() ?? '';

  return {
    known: read('LoadState') === 'loaded',
    // Up, or on its way: another `start` changes neither. Read as down, a
    // unit still `activating` — a daemon loading a chain's index — or
    // mid-`reload` was planned to start again on every pass.
    active: ['active', 'activating', 'reloading'].includes(read('ActiveState')),
    // `static` and `enabled-runtime` are both "it will come up"; only
    // `disabled` and `masked` are not.
    enabled: ['enabled', 'enabled-runtime', 'static', 'indirect'].includes(read('UnitFileState')),
  };
}

export async function applyBareMetal(
  actions: readonly BareMetalAction[],
  host: HostRunner,
  logger: ILogger,
  service: string,
): Promise<{ applied: BareMetalAction[]; failed: { action: BareMetalAction; error: string } | null }> {
  const applied: BareMetalAction[] = [];

  for (const action of actions) {
    try {
      await applyOne(action, host);
      applied.push(action);
      logger.info({ service, action: describe(action) }, 'Bare-metal service reconciled');
    } catch (err) {
      // Stopped at the first failure, deliberately: these actions are
      // ordered by dependency — an account before what it owns, a config
      // before the restart that reads it — so continuing past one runs the
      // rest against a state they were not planned for.
      logger.error(
        { service, action: describe(action), error: (err as Error).message },
        'Bare-metal reconcile step failed — stopping before the steps that depend on it',
      );
      return { applied, failed: { action, error: (err as Error).message } };
    }
  }

  return { applied, failed: null };
}

async function applyOne(action: BareMetalAction, host: HostRunner): Promise<void> {
  switch (action.type) {
    case 'install': {
      // The one place a declared string is run as a command line: package
      // installation is written by an operator as a shell line and has no
      // faithful argv form.
      const r = await host.shell(action.command, { timeoutMs: 20 * 60_000 });
      if (!r.ok) throw new Error(`install failed: ${firstLine(r.stderr || r.stdout)}`);
      return;
    }

    case 'create-user': {
      // A service account, not a person: no login shell, no home, no
      // password. `--system` keeps it out of the human uid range.
      const r = await host.run(['useradd', '--system', '--no-create-home', '--shell', '/usr/sbin/nologin', action.user]);
      if (!r.ok && !/already exists/i.test(r.stderr)) {
        throw new Error(`could not create user ${action.user}: ${firstLine(r.stderr)}`);
      }
      return;
    }

    case 'disable-unit': {
      const r = await host.run(['systemctl', 'disable', action.unit]);
      if (!r.ok) throw new Error(`could not disable ${action.unit}: ${firstLine(r.stderr)}`);
      return;
    }

    case 'adopt-data-dir': {
      // A rename or nothing: across filesystems it fails, rather than start
      // copying a chain inside a reconcile pass.
      await host.rename(action.from, action.to);
      if (action.setAside) {
        await host.rename(`${action.to}/${action.setAside.file}`, `${action.to}/${action.setAside.as}`);
      }
      if (action.owner) {
        const owned = await host.run(['chown', '-R', `${action.owner}:${action.owner}`, action.to], {
          timeoutMs: 5 * 60_000,
        });
        if (!owned.ok) throw new Error(`could not give ${action.to} to ${action.owner}: ${firstLine(owned.stderr)}`);
      }
      await host.run(['chmod', '750', action.to]);
      return;
    }

    case 'create-data-dir': {
      const made = await host.run(['mkdir', '-p', action.path]);
      if (!made.ok) throw new Error(`could not create ${action.path}: ${firstLine(made.stderr)}`);
      if (action.owner) {
        const owned = await host.run(['chown', '-R', `${action.owner}:${action.owner}`, action.path]);
        if (!owned.ok) throw new Error(`could not give ${action.path} to ${action.owner}: ${firstLine(owned.stderr)}`);
      }
      // Not group- or world-readable: a chain directory holds a wallet's
      // neighbourhood even when it holds no wallet.
      await host.run(['chmod', '750', action.path]);
      return;
    }

    case 'write-config':
      await host.writeFile(action.path, action.content, { mode: action.mode, owner: action.owner });
      return;

    case 'write-unit':
      // 0644 and root-owned: systemd refuses to read a unit that is group-
      // or world-writable, and a unit holds no secret — the config it points
      // at does.
      await host.writeFile(action.path, action.content, { mode: '0644' });
      return;

    case 'daemon-reload': {
      const r = await host.run(['systemctl', 'daemon-reload']);
      if (!r.ok) throw new Error(`could not reload systemd: ${firstLine(r.stderr)}`);
      return;
    }

    case 'enable-unit': {
      const r = await host.run(['systemctl', 'enable', action.unit]);
      if (!r.ok) throw new Error(`could not enable ${action.unit}: ${firstLine(r.stderr)}`);
      return;
    }

    // Queued, not waited for. A start waits for everything the unit is
    // ordered after and, for some types, for the daemon to say it is ready;
    // the test node's bitcoind start was cut at this pass's 120 s with no
    // reason given (2026-09-23), while systemd went on starting it. Whether
    // it came up is the next observation's question, and its health check's.
    case 'start-unit': {
      const r = await host.run(['systemctl', 'start', '--no-block', action.unit]);
      if (!r.ok) throw new Error(`could not start ${action.unit}: ${firstLine(r.stderr)}`);
      return;
    }

    case 'restart-unit': {
      const r = await host.run(['systemctl', 'restart', '--no-block', action.unit]);
      if (!r.ok) throw new Error(`could not restart ${action.unit}: ${firstLine(r.stderr)}`);
      return;
    }
    default: {
      // An action this runner cannot perform is a failed step, never a done
      // one: the reconcile loop counts whatever returns here as applied.
      const unexpected: never = action;
      throw new Error(`unknown bare-metal action: ${JSON.stringify(unexpected)}`);
    }
  }
}

export function describe(action: BareMetalAction): string {
  switch (action.type) {
    case 'install': return `install (${firstLine(action.command)})`;
    case 'write-unit': return `write unit ${action.path}`;
    case 'daemon-reload': return 'reload systemd';
    case 'create-user': return `create service account ${action.user}`;
    case 'disable-unit': return `disable ${action.unit} — ${action.because}`;
    case 'adopt-data-dir':
      return (
        `take over ${action.from} as ${action.to}` +
        (action.setAside ? `, its ${action.setAside.file} kept as ${action.setAside.as}` : '') +
        (action.owner ? `, owned by ${action.owner}` : '')
      );
    case 'create-data-dir': return `create ${action.path}`;
    case 'write-config': return `write ${action.path} (${action.mode})`;
    case 'enable-unit': return `enable ${action.unit}`;
    case 'start-unit': return `start ${action.unit}`;
    case 'restart-unit': return `restart ${action.unit} — ${action.because}`;
    default: {
      const unexpected: never = action;
      return `unknown action ${JSON.stringify(unexpected)}`;
    }
  }
}

function firstLine(text: string): string {
  return (text ?? '').split('\n')[0]?.trim() ?? '';
}

// =============================================================================
// The host this daemon is running on
// =============================================================================

/**
 * A command that did not succeed, with words for why.
 *
 * `stderr ?? message` kept a killed command's empty stderr — `''` is not
 * nullish — and every step built on it said «could not start bitcoind: »
 * and stopped there (the test node, 2026-09-23, at exactly the 120 s the
 * command was given).
 */
function failed(err: unknown, timeoutMs: number): CommandResult {
  const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
  const why = e.killed ? `no answer in ${timeoutMs} ms, stopped` : e.stderr?.trim() || e.message?.trim() || 'failed';
  return { ok: false, stdout: String(e.stdout ?? ''), stderr: why };
}

/**
 * A `HostRunner` for the machine this process is on.
 *
 * `provisionStack` executes on the node, so "the host" is local: no SSH, no
 * quoting, and no second machine's idea of what is installed.
 *
 * Writes are atomic and never pass through a shell. A config file is created
 * with its final permissions BEFORE anything is written into it — created
 * 0644 and chmod-ed afterwards leaves a window in which credentials are
 * world-readable, and a window is all a `while :; do cat` loop needs.
 */
export function localHost(): HostRunner {
  return {
    async run(argv, options) {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const [command, ...args] = argv;
      if (!command) return { ok: false, stdout: '', stderr: 'no command' };
      const timeoutMs = options?.timeoutMs ?? 30_000;
      try {
        const { stdout, stderr } = await execFileAsync(command, args, { encoding: 'utf-8', timeout: timeoutMs });
        return { ok: true, stdout: String(stdout), stderr: String(stderr) };
      } catch (err) {
        return failed(err, timeoutMs);
      }
    },

    async shell(command, options) {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);
      const timeoutMs = options?.timeoutMs ?? 30_000;
      try {
        const { stdout, stderr } = await execAsync(command, { encoding: 'utf-8', timeout: timeoutMs });
        return { ok: true, stdout: String(stdout), stderr: String(stderr) };
      } catch (err) {
        return failed(err, timeoutMs);
      }
    },

    async readFile(path) {
      const fs = await import('node:fs/promises');
      try {
        return await fs.readFile(path, 'utf-8');
      } catch {
        return null;
      }
    },

    async writeFile(path, content, options) {
      const fs = await import('node:fs/promises');
      const nodePath = await import('node:path');

      await fs.mkdir(nodePath.dirname(path), { recursive: true });

      // Same directory as the destination so the rename is atomic — across
      // filesystems it is a copy, and a copy is not.
      const staging = `${path}.omnitron-${process.pid}`;
      const mode = Number.parseInt(options.mode, 8);
      await fs.writeFile(staging, content, { mode, encoding: 'utf-8' });
      await fs.chmod(staging, mode);

      if (options.owner) {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        await promisify(execFile)('chown', [`${options.owner}:${options.owner}`, staging]).catch(() => undefined);
      }

      await fs.rename(staging, path);
    },

    async exists(path) {
      const fs = await import('node:fs/promises');
      try {
        await fs.access(path);
        return true;
      } catch {
        return false;
      }
    },

    async rename(from, to) {
      const fs = await import('node:fs/promises');
      await fs.rename(from, to);
    },
  };
}
