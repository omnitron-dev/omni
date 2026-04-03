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
// Service
// =============================================================================

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

      // Wire adapter events to logger
      this.engine.on('command:start', (event: any) => {
        this.logger.debug({ command: event.command?.slice(0, 100) }, 'Exec start');
      });
      this.engine.on('command:complete', (event: any) => {
        this.logger.debug(
          { command: event.command?.slice(0, 100), exitCode: event.exitCode, duration: event.duration },
          'Exec complete'
        );
      });
      this.engine.on('command:error', (event: any) => {
        this.logger.warn(
          { command: event.command?.slice(0, 100), error: event.error?.message },
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
  async ssh(target: SSHTarget, command: string, options?: ExecOptions): Promise<ExecResult> {
    const engine = await this.getEngine();
    const start = Date.now();

    if (engine) {
      try {
        const ssh = engine.ssh({
          host: target.host,
          port: target.port ?? 22,
          username: target.username ?? 'root',
          ...(target.privateKey && { privateKey: target.privateKey }),
          ...(target.passphrase && { passphrase: target.passphrase }),
          ...(target.password && { password: target.password }),
        });
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
