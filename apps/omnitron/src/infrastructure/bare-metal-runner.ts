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
import type { BareMetalAction, BareMetalObservation, BareMetalSpec } from './bare-metal-plan.js';

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

  return {
    installed,
    userExists,
    dataDirExists,
    unitKnown: unit.known,
    unitActive: unit.active,
    unitEnabled: unit.enabled,
    configContent,
  };
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
    active: read('ActiveState') === 'active',
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

    case 'enable-unit': {
      const r = await host.run(['systemctl', 'enable', action.unit]);
      if (!r.ok) throw new Error(`could not enable ${action.unit}: ${firstLine(r.stderr)}`);
      return;
    }

    case 'start-unit': {
      const r = await host.run(['systemctl', 'start', action.unit], { timeoutMs: 120_000 });
      if (!r.ok) throw new Error(`could not start ${action.unit}: ${firstLine(r.stderr)}`);
      return;
    }

    case 'restart-unit': {
      const r = await host.run(['systemctl', 'restart', action.unit], { timeoutMs: 120_000 });
      if (!r.ok) throw new Error(`could not restart ${action.unit}: ${firstLine(r.stderr)}`);
      return;
    }
  }
}

export function describe(action: BareMetalAction): string {
  switch (action.type) {
    case 'install': return `install (${firstLine(action.command)})`;
    case 'create-user': return `create service account ${action.user}`;
    case 'create-data-dir': return `create ${action.path}`;
    case 'write-config': return `write ${action.path} (${action.mode})`;
    case 'enable-unit': return `enable ${action.unit}`;
    case 'start-unit': return `start ${action.unit}`;
    case 'restart-unit': return `restart ${action.unit} — ${action.because}`;
  }
}

function firstLine(text: string): string {
  return (text ?? '').split('\n')[0]?.trim() ?? '';
}

// =============================================================================
// The host this daemon is running on
// =============================================================================

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
      try {
        const { stdout, stderr } = await execFileAsync(command, args, {
          encoding: 'utf-8',
          timeout: options?.timeoutMs ?? 30_000,
        });
        return { ok: true, stdout: String(stdout), stderr: String(stderr) };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        return { ok: false, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message ?? '') };
      }
    },

    async shell(command, options) {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);
      try {
        const { stdout, stderr } = await execAsync(command, {
          encoding: 'utf-8',
          timeout: options?.timeoutMs ?? 30_000,
        });
        return { ok: true, stdout: String(stdout), stderr: String(stderr) };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        return { ok: false, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message ?? '') };
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
  };
}
