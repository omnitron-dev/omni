/**
 * ExecutionService — Titan service wrapping @xec-sh/core ExecutionEngine
 *
 * Provides unified command execution across local, SSH, Docker, and Kubernetes
 * targets. Routes adapter events to logging and metrics.
 *
 * Usage in other services:
 *   const result = await executionService.local`docker ps`;
 *   const result = await executionService.ssh('prod-1')`systemctl status app`;
 *   const result = await executionService.docker('container-name')`cat /etc/config`;
 */

import type { ILogger } from '@omnitron-dev/titan/module/logger';

// =============================================================================
// Types
// =============================================================================

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

export interface SSHTarget {
  host: string;
  port?: number;
  username?: string;
  privateKey?: string;
  /** Passphrase for encrypted private keys */
  passphrase?: string;
  password?: string;
}

export interface DockerTarget {
  container: string;
  /** Execute via SSH to remote Docker host */
  sshTarget?: SSHTarget;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  /** Suppress stderr in logs */
  quiet?: boolean;
}

// =============================================================================
// xec event payloads
// =============================================================================

/**
 * The three `command:*` payloads `@xec-sh/core` emits, mirrored locally.
 *
 * The package declares them (`CommandStartEvent` and friends) but re-exports
 * only `EventFilter` from its root, so importing them means reaching into
 * `dist/types/` — a path that is not part of its public surface and would
 * break on any repackaging. Twelve lines of structural typing buys the same
 * checking without that coupling; if the payloads drift, the handlers below
 * stop compiling, which is the whole point.
 */
interface XecCommandStart {
  command?: string;
  args?: string[];
  cwd?: string;
}

interface XecCommandComplete {
  command?: string;
  exitCode?: number;
  duration?: number;
}

interface XecCommandError {
  command?: string;
  /** Flattened by the engine: `error instanceof Error ? error.message : String(error)`. */
  error?: string;
  duration?: number;
}

/**
 * Render the `command:error` reason.
 *
 * The contract says `string`, and the fallbacks are for the version that
 * does not: an engine that starts passing the Error itself must not silently
 * turn this log line back into `[object Object]`.
 */
export function describeXecError(error: unknown): string {
  if (typeof error === 'string') return error || 'unknown error';
  if (error instanceof Error) return error.message || error.name;
  if (error && typeof error === 'object') {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return error == null ? 'unknown error' : String(error);
}

// =============================================================================
// Service
// =============================================================================

/**
 * One SSH connection config, with a budget a control plane can meet.
 *
 * ssh2's `readyTimeout` defaults to 20 seconds, and a handshake is
 * arithmetic performed in JavaScript — on the same event loop the daemon
 * uses to supervise processes and reconcile containers. Twenty seconds is a
 * generous budget for an idle process and a tight one for a busy daemon.
 *
 * Measured: `omnitron fleet upgrade` from a daemon that was starting six
 * applications failed with `Timed out while waiting for handshake`, against
 * a node whose load average was 0.02, which accepted a connection from the
 * CLI seconds later, and whose sshd logged no refusal. The node was idle;
 * the handshake never got the CPU.
 *
 * The keepalives are for the other end of the same problem: a tunnel the
 * mesh holds open for hours across a link that drops idle connections. Four
 * missed probes at fifteen seconds is a minute of silence before the socket
 * is called dead, which is longer than any pause the event loop has been
 * measured to take.
 *
 * Written once because it was written three times: `ssh`, `tunnel` and
 * `uploadFile` each built this object, and a change to any of them would
 * have reached one of the three.
 */
function sshConfig(target: SSHTarget): Record<string, unknown> {
  return {
    host: target.host,
    port: target.port ?? 22,
    username: target.username ?? 'root',
    ...(target.privateKey && { privateKey: target.privateKey }),
    ...(target.passphrase && { passphrase: target.passphrase }),
    ...(target.password && { password: target.password }),
    readyTimeout: 60_000,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 4,
  };
}

export class ExecutionService {
  private engine: any = null;
  private initialized = false;

  constructor(private readonly logger: ILogger) {}

  /**
   * Lazy-initialize the xec ExecutionEngine.
   * Dynamic import to avoid loading xec until actually needed.
   */
  private async getEngine(): Promise<any> {
    if (this.engine) return this.engine;

    try {
      const xec = await import('@xec-sh/core');
      this.engine = new xec.ExecutionEngine({
        defaultTimeout: 30_000,
        defaultShell: '/bin/sh',
      });

      // Wire adapter events to logger.
      //
      // The payloads are typed locally rather than inferred from `any`: the
      // engine handle has to stay `any` (the import is dynamic and optional),
      // and without these shapes nothing checks what the handlers read. That
      // is not hypothetical — `command:error` carries `error` as a *string*,
      // already flattened by the engine, and this handler used to log
      // `event.error?.message`, which is `undefined` on a string. Every
      // failed remote command logged `Exec error {"error":undefined}`: a
      // warning that names the problem and then withholds it.
      this.engine.on('command:start', (event: XecCommandStart) => {
        this.logger.debug({ command: event.command?.slice(0, 100) }, 'Exec start');
      });
      this.engine.on('command:complete', (event: XecCommandComplete) => {
        this.logger.debug(
          { command: event.command?.slice(0, 100), exitCode: event.exitCode, duration: event.duration },
          'Exec complete'
        );
      });
      this.engine.on('command:error', (event: XecCommandError) => {
        this.logger.warn(
          { command: event.command?.slice(0, 100), error: describeXecError(event.error), duration: event.duration },
          'Exec error'
        );
      });

      this.initialized = true;
      this.logger.info('ExecutionEngine initialized (xec/core)');
    } catch (err) {
      this.logger.warn(
        { error: (err as Error).message },
        'Failed to initialize xec ExecutionEngine — falling back to child_process'
      );
    }

    return this.engine;
  }

  /**
   * Execute a local command.
   */
  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const engine = await this.getEngine();
    const start = Date.now();

    if (engine) {
      try {
        // Use xec raw template literal API — engine.run() interpolates options into
        // the command string which corrupts it. Raw mode passes command as-is.
        let proc = engine.raw([command] as any);
        if (options?.timeout) proc = proc.timeout(options.timeout);
        if (options?.cwd) proc = proc.cwd(options.cwd);
        if (options?.env) proc = proc.env(options.env);

        const result = await proc.nothrow();
        return {
          stdout: result.stdout?.trim() ?? '',
          stderr: result.stderr?.trim() ?? '',
          exitCode: result.exitCode ?? 0,
          duration: Date.now() - start,
        };
      } catch (err: any) {
        return {
          stdout: err.stdout?.trim() ?? '',
          stderr: err.stderr?.trim() ?? err.message,
          exitCode: err.exitCode ?? 1,
          duration: Date.now() - start,
        };
      }
    }

    // Fallback: child_process
    return this.execFallback(command, options);
  }

  /**
   * Execute command on a remote host via SSH.
   */
  /**
   * A local port that speaks to `remotePort` on the target, over SSH.
   *
   * The master reaches a node's daemon on its TCP port. A node whose firewall
   * allows only SSH — which is the normal posture for a machine on the public
   * internet, and what the first provisioned node turned out to have — is
   * then unreachable, and the mesh it is supposed to join cannot form. The
   * symptom is silence: the node answers SSH, deploys fine, reports healthy,
   * and replicates nothing.
   *
   * Measured on that node: `ss -ltn` shows the daemon on `0.0.0.0:9700`, and
   * `ufw status` allows 22/tcp and three ports from one private address. A
   * direct connection times out; through this, the same daemon answers.
   *
   * Opening the port on the node would be the other fix, and it is worse: it
   * asks every operator to widen a firewall for a control plane that already
   * holds SSH credentials for the machine. Whoever can open this tunnel can
   * already run commands there.
   *
   * The caller owns the returned handle and must `close()` it — each one
   * holds an SSH connection.
   */
  async tunnel(
    target: SSHTarget,
    remotePort: number,
    options?: { remoteHost?: string; localHost?: string },
  ): Promise<{ host: string; port: number; close(): Promise<void> }> {
    const engine = await this.getEngine();
    if (!engine) throw new Error('SSH tunnelling needs the xec engine, which is not available');

    const ssh = engine.ssh(sshConfig(target));

    if (typeof ssh.tunnel !== 'function') {
      throw new Error('The installed @xec-sh/core has no SSH tunnel support');
    }

    // `remoteHost` is resolved ON the node, so loopback is the node's own
    // daemon rather than ours.
    const handle = await ssh.tunnel({
      localHost: options?.localHost ?? '127.0.0.1',
      remoteHost: options?.remoteHost ?? '127.0.0.1',
      remotePort,
    });

    this.logger.debug(
      { host: target.host, localPort: handle.localPort, remotePort },
      'SSH tunnel open',
    );

    return {
      host: handle.localHost ?? '127.0.0.1',
      port: handle.localPort,
      close: async () => {
        try {
          await handle.close();
        } catch (err) {
          this.logger.debug({ host: target.host, error: (err as Error).message }, 'SSH tunnel close failed');
        }
      },
    };
  }

  async ssh(target: SSHTarget, command: string, options?: ExecOptions): Promise<ExecResult> {
    const engine = await this.getEngine();
    const start = Date.now();

    if (engine) {
      try {
        const ssh = engine.ssh(sshConfig(target));
        // Use raw template literal to avoid options interpolation into command
        let proc = ssh.raw([command] as any);
        if (options?.timeout) proc = proc.timeout(options.timeout);
        if (options?.env) proc = proc.env(options.env);
        const result = await proc.nothrow();
        return {
          stdout: result.stdout?.trim() ?? '',
          stderr: result.stderr?.trim() ?? '',
          exitCode: result.exitCode ?? 0,
          duration: Date.now() - start,
        };
      } catch (err: any) {
        return {
          stdout: '',
          stderr: err.message,
          exitCode: 1,
          duration: Date.now() - start,
        };
      }
    }

    // Fallback: ssh command via child_process
    const sshCmd = `ssh -o StrictHostKeyChecking=no -p ${target.port ?? 22} ${target.username ?? 'root'}@${target.host} "${command.replace(/"/g, '\\"')}"`;
    return this.execFallback(sshCmd, options);
  }

  /**
   * Copy a local file to a remote host over the SSH connection.
   *
   * Here rather than in the caller because this class owns the engine, and
   * because the alternative already existed and could not work: deployment
   * shelled out to `scp`, which — like the `ssh -o BatchMode=yes` beside it —
   * can offer a key file and nothing else. The console collects passwords and
   * key passphrases and keeps them in the daemon's vault, so every node
   * registered that way was untransferable-to by construction.
   *
   * The engine speaks SFTP over the same authenticated connection as
   * `ssh()`, so one credential path serves both.
   */
  async uploadFile(target: SSHTarget, localPath: string, remotePath: string): Promise<void> {
    const engine = await this.getEngine();
    if (!engine) {
      // No silent fallback to `scp`. It cannot present a password, so it
      // would fail with "Permission denied (publickey,password)" — an error
      // that sends the reader to the node's credentials, which are fine.
      throw new Error(
        'Cannot transfer files: the execution engine is unavailable, and the fallback cannot use stored credentials.',
      );
    }
    const ssh = engine.ssh(sshConfig(target));
    await ssh.uploadFile(localPath, remotePath);
  }

  /**
   * Execute command inside a Docker container.
   */
  async docker(target: DockerTarget, command: string, options?: ExecOptions): Promise<ExecResult> {
    // If remote Docker host, pipe through SSH
    if (target.sshTarget) {
      return this.ssh(target.sshTarget, `docker exec ${target.container} ${command}`, options);
    }
    return this.exec(`docker exec ${target.container} ${command}`, options);
  }

  /**
   * Dispose the execution engine and close all connections.
   */
  async dispose(): Promise<void> {
    if (this.engine && typeof this.engine.dispose === 'function') {
      await this.engine.dispose();
    }
    this.engine = null;
    this.initialized = false;
  }

  /**
   * Check if xec engine is available.
   */
  isAvailable(): boolean {
    return this.initialized;
  }

  // ===========================================================================
  // Private — Fallback execution via child_process
  // ===========================================================================

  private async execFallback(command: string, options?: ExecOptions): Promise<ExecResult> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(execFile);
    const start = Date.now();

    try {
      const { stdout, stderr } = await execAsync('/bin/sh', ['-c', command], {
        cwd: options?.cwd,
        env: options?.env ? { ...process.env, ...options.env } : undefined,
        timeout: options?.timeout ?? 30_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        duration: Date.now() - start,
      };
    } catch (err: any) {
      return {
        stdout: err.stdout?.trim() ?? '',
        stderr: err.stderr?.trim() ?? err.message,
        exitCode: err.code ?? 1,
        duration: Date.now() - start,
      };
    }
  }
}
