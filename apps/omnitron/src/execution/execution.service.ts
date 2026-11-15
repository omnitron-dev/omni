/** Shared Xec lifecycle and diagnostics for Omnitron command execution. */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { shellEscape } from '../shared/shell-escape.js';
import type {
  Command, ExecutionEngine, ExecutionResult, ExecutionResource, ExecutionResourceObservation,
  SSHAdapterOptions, CommandStartEvent, CommandCompleteEvent, CommandErrorEvent,
} from '@xec-sh/core';
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
  expectedHostFingerprint?: string;
  privateKey?: string;
  /** Passphrase for encrypted private keys */
  passphrase?: string;
  password?: string;
}

export interface UploadOptions {
  /** A deployment may fence verification and promotion under its node lease. */
  runControl(command: string, timeout: number): Promise<Pick<ExecResult, 'stdout' | 'stderr' | 'exitCode'>>;
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
  signal?: AbortSignal;
}

function commandOptions(options?: ExecOptions): Pick<Command, 'cwd' | 'env' | 'timeout' | 'signal'> {
  return { ...(options?.cwd !== undefined && { cwd: options.cwd }),
    ...(options?.env !== undefined && { env: options.env }),
    ...(options?.timeout !== undefined && { timeout: options.timeout }),
    ...(options?.signal !== undefined && { signal: options.signal }) };
}

/** Render an already sanitized diagnostic without losing its useful message. */
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
 * How long one file transfer may take: a minute to open it, and the bytes at
 * no less than 32 KiB/s.
 *
 * A transfer had no bound at all, and on 2026-09-24 three of them never
 * ended: `sample/test` stood «delivering 6 artifact(s)» for 19 minutes, holding
 * the node's deploy lease, until the master was restarted. The chain is in
 * `@xec-sh/core`: every channel to a node rides ONE pooled SSH connection, a
 * command that timed out behind the transfers made the pool close that
 * connection with a graceful `end()` — which stops ssh2's keepalive — and a
 * transfer still running on it got neither an error nor an end. New commands
 * opened a new connection and worked; the transfers on the old one waited
 * forever. Only a deadline of our own ends them.
 *
 * The floor is generous on purpose — measured the day after, 26 MB of
 * artifacts crossed in ~70 s, about 0.4 MB/s — so a slow link still delivers,
 * and a dead one fails in minutes, with its words, instead of never.
 */
export const UPLOAD_STALL_MS = 120_000;

export function uploadDeadlineMs(bytes: number): number {
  return 60_000 + Math.ceil(bytes / (32 * 1024)) * 1000;
}

/** Shared authentication, trust and keepalive policy for commands, tunnels and uploads. */
export function sshConfig(target: SSHTarget): Omit<SSHAdapterOptions, 'type'> {
  return {
    host: target.host,
    hostKeyChecking: 'strict',
    ...(target.expectedHostFingerprint !== undefined && { expectedHostFingerprint: target.expectedHostFingerprint }),
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
  private engine?: Promise<ExecutionEngine>;
  private initialized = false;
  private closed = false;

  constructor(private readonly logger: ILogger) {}

  /**
   * Lazy-initialize the xec ExecutionEngine.
   * Dynamic import to avoid loading xec until actually needed.
   */
  private getEngine(): Promise<ExecutionEngine> {
    if (this.closed) return Promise.reject(new Error('Execution service is disposed'));
    return this.engine ??= import('@xec-sh/core').then(xec => {
      if (this.closed) throw new Error('Execution service is disposed');
      const engine = new xec.ExecutionEngine({
        defaultTimeout: 30_000,
        defaultShell: '/bin/sh',
      });

      // Xec sanitizes these public diagnostic events before emission.
      engine.on('command:start', (event: CommandStartEvent) => {
        this.logger.debug({ command: event.command?.slice(0, 100) }, 'Exec start');
      });
      engine.on('command:complete', (event: CommandCompleteEvent) => {
        this.logger.debug(
          { command: event.command?.slice(0, 100), exitCode: event.exitCode, duration: event.duration },
          'Exec complete'
        );
      });
      engine.on('command:error', (event: CommandErrorEvent) => {
        this.logger.warn(
          { command: event.command?.slice(0, 100), error: describeXecError(event.error), duration: event.duration },
          'Exec error'
        );
      });

      this.initialized = true;
      this.logger.info('ExecutionEngine initialized (xec/core)');
      return engine;
    });
  }

  /** The shared typed executor. Transport uncertainty always remains an error. */
  async execute(command: Command): Promise<ExecutionResult> {
    return (await this.getEngine()).execute(command);
  }

  async inspectExecution(resource: ExecutionResource): Promise<ExecutionResourceObservation> {
    return (await this.getEngine()).inspectExecution(resource);
  }

  async terminateExecution(resource: ExecutionResource): Promise<ExecutionResourceObservation> {
    return (await this.getEngine()).terminateExecution(resource);
  }

  /** Resolve a running container and its immutable image through the same pinned adapter. */
  async inspectDockerTarget(container: string): Promise<{ id: string; image: string }> {
    const engine = await this.getEngine();
    const { DockerAdapter } = await import('@xec-sh/core');
    const adapter = engine.getAdapter('docker');
    if (!(adapter instanceof DockerAdapter)) throw new Error('Docker execution adapter is unavailable');
    const value = await adapter.inspectContainer(container) as { Id?: unknown; Image?: unknown; State?: { Running?: unknown } };
    if (typeof value.Id !== 'string' || !/^[a-f0-9]{64}$/.test(value.Id) ||
        typeof value.Image !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.Image) || value.State?.Running !== true)
      throw new Error('Database container identity, image or running state is unconfirmed');
    return { id: value.Id, image: value.Image };
  }

  /**
   * Execute a local command.
   */
  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const start = Date.now();
    const result = await this.execute({ command, shell: '/bin/sh', nothrow: true,
      ...commandOptions(options) });
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode,
      duration: Date.now() - start };
  }

  /**
   * Expose the node's remote port through a local SSH listener. The caller
   * owns the handle and must close it. Xec pins each active tunnel's lease;
   * normal idle and lifetime cleanup resumes when the last lease is released.
   */
  async tunnel(
    target: SSHTarget,
    remotePort: number,
    options?: { remoteHost?: string; localHost?: string }
  ): Promise<{ host: string; port: number; close(): Promise<void> }> {
    const engine = await this.getEngine();
    const ssh = engine.ssh(sshConfig(target));

    // `remoteHost` is resolved ON the node, so loopback is the node's own
    // daemon rather than ours.
    const handle = await ssh.tunnel({
      localHost: options?.localHost ?? '127.0.0.1',
      remoteHost: options?.remoteHost ?? '127.0.0.1',
      remotePort,
    });

    this.logger.debug({ host: target.host, localPort: handle.localPort, remotePort }, 'SSH tunnel open');

    return {
      host: handle.localHost ?? '127.0.0.1',
      port: handle.localPort,
      close: async () => {
        try {
          await handle.close();
        } catch (err) {
          this.logger.debug({ host: target.host, error: describeXecError(err) }, 'SSH tunnel close failed');
          throw err;
        }
      },
    };
  }

  async ssh(target: SSHTarget, command: string, options?: ExecOptions & { stdin?: string | Buffer }): Promise<ExecResult> {
    const start = Date.now();
    const result = await this.execute({ command, shell: '/bin/sh', nothrow: true,
      adapter: 'ssh', adapterOptions: { type: 'ssh', ...sshConfig(target) },
      ...commandOptions(options), ...(options?.stdin !== undefined && { stdin: options.stdin }) });
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode,
      duration: Date.now() - start };
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
  async uploadFile(target: SSHTarget, localPath: string, remotePath: string, options?: UploadOptions): Promise<void> {
    // Serialize bulk transfers per node. Each owns a dedicated connection;
    // lease and control commands use the independent main engine.
    const node = `${target.host}:${target.port ?? 22}`;
    const queue = (this.transfersByNode ??= new Map<string, Promise<void>>());
    const before = queue.get(node) ?? Promise.resolve();
    const mine = before.then(() => this.transferOnce(target, localPath, remotePath, options));
    const settled = mine.catch(() => undefined);
    queue.set(node, settled);
    try {
      await mine;
    } finally {
      if (queue.get(node) === settled) queue.delete(node);
    }
  }

  /** Transfers still to finish, per node — see `uploadFile`. */
  private transfersByNode?: Map<string, Promise<void>>;

  /** Bulk channels must never share a pool with deployment lease/control commands. */
  private async createTransferEngine(): Promise<ExecutionEngine> {
    const xec = await import('@xec-sh/core');
    return new xec.ExecutionEngine({
      defaultTimeout: 30_000,
      defaultShell: '/bin/sh',
    });
  }

  private async transferOnce(target: SSHTarget, localPath: string, remotePath: string, options?: UploadOptions): Promise<void> {
    const fsp = await import('node:fs/promises');
    const stat = await fsp.stat(localPath);
    if (!stat.isFile()) throw new Error('Upload source must be a regular file');
    const expected = stat.size;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(localPath)) hash.update(chunk);
    const digest = hash.digest('hex');
    const control = async (command: string): Promise<string> => {
      const out = await this.ssh(target, command, { timeout: 30_000 });
      if (out.exitCode !== 0) throw new Error(`Upload verification command failed (${out.exitCode}): ${out.stderr}`);
      return out.stdout.trim();
    };
    for (let attempt = 1; attempt <= 2; attempt++) {
      const temporary = remotePath + '.upload-' + randomUUID() + '.part';
      const engine = await this.createTransferEngine();
      let stop = false;
      let poll: ReturnType<typeof setTimeout> | undefined;
      let wake: (() => void) | undefined;
      let watch: Promise<never> | undefined;
      let transferStarted = false;
      let transferCompleted = false;
      let promotionAttempted = false;
      let promotionCompleted = false;
      let uncertain = false;
      let failure: Error | undefined;
      let retry = false;
      try {
        await control(`umask 077 && (set -C; : > ${shellEscape(temporary)})`);
        let lastSize = 0;
        let lastProgress = Date.now();
        watch = (async () => {
          while (!stop) {
            await new Promise<void>((resolve) => {
              wake = resolve;
              poll = setTimeout(resolve, 15_000);
            });
            if (stop) break;
            const size = Number(await control(`wc -c < ${shellEscape(temporary)}`));
            if (!Number.isSafeInteger(size) || size < lastSize || size > expected)
              throw new Error('Invalid upload progress');
            if (size > lastSize) {
              lastSize = size;
              lastProgress = Date.now();
            }
            if (Date.now() - lastProgress >= UPLOAD_STALL_MS)
              throw new Error(
                `Upload to ${target.host}:${remotePath} made no progress for ${UPLOAD_STALL_MS / 1000} s; temporary file was not promoted`
              );
          }
          return await new Promise<never>(() => {});
        })();
        transferStarted = true;
        await this.withinDeadline(
          Promise.race([engine.ssh(sshConfig(target)).uploadFile(localPath, temporary), watch]),
          uploadDeadlineMs(expected),
          (ms) =>
            new Error(
              `Upload of ${localPath} (${expected} bytes) to ${target.host}:${remotePath} did not finish in ${Math.round(ms / 1000)} s; temporary file was not promoted`
            )
        );
        transferCompleted = true;
        stop = true;
        clearTimeout(poll);
        wake?.();
        const landed = Number(await control(`wc -c < ${shellEscape(temporary)}`));
        if (!Number.isSafeInteger(landed) || landed !== expected)
          throw new Error(
            `Upload landed ${Number.isFinite(landed) ? landed : 'an unreadable size'} of ${expected} bytes`
          );
        const actual = (
          await control(
            `if command -v sha256sum >/dev/null 2>&1; then sha256sum ${shellEscape(temporary)}; else shasum -a 256 ${shellEscape(temporary)}; fi`
          )
        ).split(/\s+/)[0];
        if (actual !== digest) throw new Error('Uploaded file SHA256 does not match the source');
        // The guarded command repeats byte/hash checks inside the same execution
        // fence as rename. A lost lease may finish SFTP into its unique temporary
        // file, but must never replace a newer owner's canonical destination.
        const promote =
          `test "$(wc -c < ${shellEscape(temporary)})" -eq ${expected} && ` +
          `actual=$(if command -v sha256sum >/dev/null 2>&1; then sha256sum ${shellEscape(temporary)}; else shasum -a 256 ${shellEscape(temporary)}; fi) && ` +
          `test "\${actual%% *}" = ${shellEscape(digest)} && ` +
          `chmod ${(stat.mode & 0o777).toString(8)} ${shellEscape(temporary)} && test ! -d ${shellEscape(remotePath)} && mv -f -- ${shellEscape(temporary)} ${shellEscape(remotePath)}`;
        promotionAttempted = true;
        const out = options?.runControl
          ? await options.runControl(promote, 30_000)
          : await this.ssh(target, promote, { timeout: 30_000 });
        promotionCompleted = true;
        if (out.exitCode !== 0)
          throw new Error(`Upload promotion rejected (${out.exitCode}): ${out.stderr}`);
      } catch (error) {
        const { ExecutionOutcomeUnknownError } = await import('@xec-sh/core');
        uncertain = error instanceof ExecutionOutcomeUnknownError || (transferStarted && !transferCompleted) ||
          (promotionAttempted && !promotionCompleted);
        const cause = error instanceof Error ? error : new Error(String(error));
        failure = uncertain && !(error instanceof ExecutionOutcomeUnknownError)
          ? new ExecutionOutcomeUnknownError({ adapter: 'ssh', cause }) : cause;
        retry = !uncertain && !promotionAttempted && attempt < 2;
        if (retry) this.logger.warn(
          { remotePath, attempt, error: describeXecError(error) },
          'Upload failed before promotion; retrying with a fresh isolated connection'
        );
      } finally {
        stop = true;
        clearTimeout(poll);
        wake?.();
        // Disposing only this engine cannot close the lease/control connection.
        try {
          await this.withinDeadline(engine.dispose(), 10_000, () => new Error('Isolated transfer connection did not close'));
        } catch (cause) {
          const { ExecutionOutcomeUnknownError } = await import('@xec-sh/core');
          failure = new ExecutionOutcomeUnknownError({ adapter: 'ssh', cause: cause instanceof Error ? cause : new Error(String(cause)) });
          uncertain = true;
          retry = false;
        }
        // An unknown write/promotion retains its evidence. No second attempt
        // may race a request whose completion the transport could not confirm.
        if (!uncertain) {
          try { await control(`rm -f -- ${shellEscape(temporary)}`); }
          catch (error) {
            failure = error instanceof Error ? error : new Error(String(error));
            retry = false;
          }
        }
      }
      if (retry) continue;
      if (failure) throw failure;
      return;
    }
  }

  /**
   * `work`, or a rejection once `ms` have passed. The work itself is not
   * stopped — nothing in the engine can stop it — only no longer waited for.
   */
  private async withinDeadline<T>(work: Promise<T>, ms: number, error: (ms: number) => Error): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(error(ms)), ms);
    });
    try {
      return await Promise.race([work, late]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Execute command inside a Docker container.
   */
  async docker(target: DockerTarget, command: string, options?: ExecOptions): Promise<ExecResult> {
    // If remote Docker host, pipe through SSH
    if (target.sshTarget) {
      return this.ssh(target.sshTarget, `docker exec ${shellEscape(target.container)} /bin/sh -c ${shellEscape(command)}`, options);
    }
    const start = Date.now();
    const result = await this.execute({ command: 'docker', args: ['exec', target.container, '/bin/sh', '-c', command],
      shell: false, nothrow: true, ...commandOptions(options) });
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode,
      duration: Date.now() - start };
  }

  /**
   * Dispose the execution engine and close all connections.
   */
  async dispose(): Promise<void> {
    this.closed = true;
    const engine = await this.engine;
    if (engine) await engine.dispose();
    this.initialized = false;
  }

  /**
   * Check if xec engine is available.
   */
  isAvailable(): boolean {
    return this.initialized;
  }

}
