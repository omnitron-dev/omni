/**
 * RemoteDeployer — SSH-based artifact deployment to remote/cluster nodes
 *
 * Deployment pipeline for a single node:
 *   1. Connect via SSH (xec SSHAdapter or child_process ssh)
 *   2. Check if omnitron daemon is installed on remote
 *   3. Transfer app artifact (tarball) via SFTP/SCP
 *   4. Extract artifact on remote node
 *   5. Signal remote omnitron daemon to reload/restart apps
 *   6. Verify health on remote
 *
 * For cluster stacks, this runs in parallel across all nodes.
 *
 * Artifact path on remote: /opt/omnitron/artifacts/<project>/<app>/<version>/
 * Remote daemon config: /etc/omnitron/omnitron.config.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { IStackNode } from '../config/types.js';
import type { ArtifactInfo } from '../project/artifact-builder.js';

const exec = promisify(execFile);

/** Escape a string for safe use inside a single-quoted shell argument. */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * A name that is safe to place in a remote filesystem path.
 *
 * Project, app and version names are interpolated into
 * `/opt/omnitron/artifacts/<project>/<app>/<version>` and the result is sent
 * to a remote shell running as the SSH user, which defaults to root. Quoting
 * makes that safe against injection but not against the path itself: a
 * project literally named `../..` resolves outside the artifact root, and
 * `mkdir -p` then creates it there. Quoting is not a substitute for the
 * value meaning what the path assumes it means.
 *
 * These names come from the project registry and the console's own forms —
 * operator-supplied, not attacker-supplied in the ordinary case. It is
 * defence in depth, and the cost of it is a regular expression.
 *
 * @throws Error naming the segment and what is allowed.
 */
export function assertRemotePathSegment(kind: string, value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.includes('..')) {
    throw new Error(
      `Refusing to deploy: ${kind} ${JSON.stringify(value)} is not usable in a remote path. ` +
        `Allowed: letters, digits, dot, dash and underscore, starting with a letter or digit, and no "..".`
    );
  }
  return value;
}

/**
 * A shell command that writes `content` to `path` on the remote.
 *
 * This was a heredoc with a fixed `OMNITRON_EOF` delimiter, and the comment
 * above it said it "avoids shell escaping issues with complex content". It
 * avoids most of them. It does not avoid content that contains a line equal
 * to the delimiter — there the heredoc ends early and everything after it is
 * executed as a command by the remote shell. `generateSlaveConfig`
 * interpolates the project name into the file it writes, so the delimiter
 * was reachable from a name.
 *
 * base64 has no delimiter to collide with and an alphabet the shell does not
 * touch, so the content cannot influence the command at all.
 */
export function writeRemoteFileCommand(path: string, content: string): string {
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  return `printf %s ${shellEscape(encoded)} | base64 -d > ${shellEscape(path)}`;
}

// =============================================================================
// Types
// =============================================================================

export type DeployStatus = 'pending' | 'transferring' | 'extracting' | 'restarting' | 'verifying' | 'success' | 'failed';

export interface DeployResult {
  node: string;
  app: string;
  version: string;
  status: DeployStatus;
  duration: number;
  error?: string;
}

export interface DeployProgress {
  node: string;
  app: string;
  status: DeployStatus;
  progress: number; // 0-100
  message: string;
}

// =============================================================================
// RemoteDeployer
// =============================================================================

export class RemoteDeployer {
  /** Active deployment progress handlers */
  private readonly progressHandlers: Array<(progress: DeployProgress) => void> = [];

  constructor(
    private readonly logger: ILogger,
  ) {}

  /**
   * Register a progress handler for real-time deployment updates.
   */
  onProgress(handler: (progress: DeployProgress) => void): () => void {
    this.progressHandlers.push(handler);
    return () => {
      const idx = this.progressHandlers.indexOf(handler);
      if (idx >= 0) this.progressHandlers.splice(idx, 1);
    };
  }

  /**
   * Deploy an artifact to a single remote node.
   */
  async deployToNode(
    node: IStackNode,
    artifact: ArtifactInfo,
    project: string,
  ): Promise<DeployResult> {
    const startTime = Date.now();
    const nodeKey = `${node.host}:${node.port ?? 9700}`;

    this.logger.info(
      { node: nodeKey, app: artifact.app, version: artifact.version },
      'Starting deployment to node'
    );

    try {
      // 1. Verify SSH connectivity
      this.emitProgress(nodeKey, artifact.app, 'pending', 0, 'Connecting via SSH...');
      await this.verifySSH(node);

      // 2. Ensure remote directory structure
      const remotePath =
        `/opt/omnitron/artifacts/${assertRemotePathSegment('project name', project)}` +
        `/${assertRemotePathSegment('app name', artifact.app)}` +
        `/${assertRemotePathSegment('version', artifact.version)}`;
      await this.sshExec(node, `mkdir -p ${shellEscape(remotePath)}`);

      // 3. Transfer artifact
      this.emitProgress(nodeKey, artifact.app, 'transferring', 20, 'Transferring artifact...');
      const remoteFile = `${remotePath}/${artifact.app}-${artifact.version}.tar.gz`;
      await this.scpTransfer(node, artifact.path, remoteFile);

      // 4. Extract on remote
      this.emitProgress(nodeKey, artifact.app, 'extracting', 50, 'Extracting artifact...');
      await this.sshExec(node, `cd ${shellEscape(remotePath)} && tar -xzf ${shellEscape(`${artifact.app}-${artifact.version}.tar.gz`)}`);

      // 5. Install production dependencies
      this.emitProgress(nodeKey, artifact.app, 'extracting', 65, 'Installing dependencies...');
      await this.sshExec(node, `cd ${shellEscape(remotePath)} && npm install --production --ignore-scripts 2>/dev/null || true`);

      // 6. Signal remote daemon to restart the app
      this.emitProgress(nodeKey, artifact.app, 'restarting', 80, 'Restarting app on remote...');
      await this.signalRemoteDaemon(node, artifact.app);

      // 7. Verify health
      this.emitProgress(nodeKey, artifact.app, 'verifying', 90, 'Verifying health...');
      await this.verifyHealth(node, artifact.app);

      const duration = Date.now() - startTime;
      this.emitProgress(nodeKey, artifact.app, 'success', 100, `Deployed in ${Math.round(duration / 1000)}s`);

      this.logger.info(
        { node: nodeKey, app: artifact.app, version: artifact.version, duration },
        'Deployment successful'
      );

      return { node: nodeKey, app: artifact.app, version: artifact.version, status: 'success', duration };
    } catch (err) {
      const duration = Date.now() - startTime;
      const error = (err as Error).message;

      this.emitProgress(nodeKey, artifact.app, 'failed', 0, error);
      this.logger.error(
        { node: nodeKey, app: artifact.app, error, duration },
        'Deployment failed'
      );

      return { node: nodeKey, app: artifact.app, version: artifact.version, status: 'failed', duration, error };
    }
  }

  /**
   * Deploy artifacts to all nodes in a stack (parallel).
   */
  async deployToStack(
    nodes: IStackNode[],
    artifacts: ArtifactInfo[],
    project: string,
    options?: { concurrency?: number },
  ): Promise<DeployResult[]> {
    const concurrency = options?.concurrency ?? 3;
    const results: DeployResult[] = [];

    // Build deployment matrix: each app to each node (or node-specific apps)
    const tasks: Array<{ node: IStackNode; artifact: ArtifactInfo }> = [];
    for (const node of nodes) {
      for (const artifact of artifacts) {
        // If node has explicit app list, only deploy matching apps
        if (node.apps && !node.apps.includes(artifact.app)) continue;
        tasks.push({ node, artifact });
      }
    }

    // Execute with concurrency limit
    const executing = new Set<Promise<void>>();
    for (const task of tasks) {
      const promise = (async () => {
        const result = await this.deployToNode(task.node, task.artifact, project);
        results.push(result);
      })();

      executing.add(promise);
      promise.finally(() => executing.delete(promise));

      if (executing.size >= concurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * Provision a remote node as a slave daemon.
   *
   * Full bootstrap sequence:
   *   1. Install Node.js/Bun if missing
   *   2. Install omnitron CLI globally
   *   3. Generate slave omnitron.config.ts with role:'slave' + master address
   *   4. Start omnitron daemon on the remote node
   *
   * After this, the node runs an autonomous slave daemon that:
   * - Supervises apps locally
   * - Collects all metrics/logs/events
   * - Syncs to master when connectivity is available
   *
   * @param masterHost - The master daemon's reachable address (from slave's perspective)
   * @param masterPort - The master daemon's fleet TCP port
   */
  async provisionSlaveNode(
    node: IStackNode,
    masterHost: string,
    masterPort: number,
    project: string,
  ): Promise<boolean> {
    const nodeKey = `${node.host}:${node.port ?? 9700}`;

    try {
      // 1. Verify SSH access
      this.emitProgress(nodeKey, '*', 'pending', 0, 'Connecting via SSH...');
      await this.verifySSH(node);

      // 2. Ensure runtime (Node.js or Bun)
      this.emitProgress(nodeKey, '*', 'extracting', 10, 'Checking runtime...');
      const hasNode = await this.sshExec(node, 'which node 2>/dev/null || which bun 2>/dev/null || echo ""').catch(() => '');
      if (!hasNode.trim()) {
        this.logger.info({ host: node.host }, 'Installing Node.js on remote node...');
        this.emitProgress(nodeKey, '*', 'extracting', 15, 'Installing Node.js...');
        try {
          // Install Node.js via official installer (works on most Linux distros)
          await this.sshExec(node, 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs 2>/dev/null || (curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - && yum install -y nodejs) 2>/dev/null || (apk add --no-cache nodejs npm)', 120_000);
        } catch (err) {
          this.logger.error({ host: node.host, error: (err as Error).message }, 'Failed to install Node.js');
          return false;
        }
      }

      // 3. Install omnitron
      this.emitProgress(nodeKey, '*', 'extracting', 30, 'Installing omnitron...');
      const hasOmnitron = await this.sshExec(node, 'which omnitron 2>/dev/null || echo ""').catch(() => '');
      if (!hasOmnitron.trim()) {
        try {
          await this.sshExec(node, 'npm install -g @omnitron-dev/omnitron', 120_000);
        } catch (err) {
          this.logger.error({ host: node.host, error: (err as Error).message }, 'Failed to install omnitron');
          return false;
        }
      }

      // 4. Generate slave config
      this.emitProgress(nodeKey, '*', 'extracting', 50, 'Configuring slave daemon...');
      const configDir = '/etc/omnitron';
      // Validated here as well as in `deployToNode`: this path provisions a
      // slave without going through artifact deployment first.
      assertRemotePathSegment('project name', project);
      const configContent = this.generateSlaveConfig(masterHost, masterPort, node.port ?? 9700, project);
      await this.sshExec(node, `mkdir -p ${shellEscape(configDir)}`);
      await this.sshExec(node, writeRemoteFileCommand(`${configDir}/omnitron.config.ts`, configContent));

      // 5. Start slave daemon (or restart if already running)
      this.emitProgress(nodeKey, '*', 'restarting', 70, 'Starting slave daemon...');
      await this.sshExec(node, `cd ${shellEscape(configDir)} && (omnitron down 2>/dev/null; omnitron up) &`).catch(() => {
        // Background start — may "fail" because SSH returns before daemon fully starts
      });

      // 6. Wait briefly and verify daemon is running
      this.emitProgress(nodeKey, '*', 'verifying', 90, 'Verifying slave daemon...');
      await new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        const pingResult = await this.sshExec(node, 'omnitron ping 2>/dev/null || echo "unreachable"', 10_000);
        if (pingResult.includes('unreachable')) {
          this.logger.warn({ host: node.host }, 'Slave daemon not yet responding — may still be starting');
        }
      } catch {
        this.logger.warn({ host: node.host }, 'Could not verify slave daemon — it may still be starting');
      }

      this.emitProgress(nodeKey, '*', 'success', 100, 'Slave provisioned');
      this.logger.info({ host: node.host, masterHost, masterPort }, 'Slave node provisioned');
      return true;
    } catch (err) {
      this.emitProgress(nodeKey, '*', 'failed', 0, (err as Error).message);
      this.logger.error({ host: node.host, error: (err as Error).message }, 'Failed to provision slave node');
      return false;
    }
  }

  /**
   * Generate omnitron.config.ts content for a slave daemon.
   */
  /**
   * The slave's `omnitron.config.ts`, as text.
   *
   * Values go in through `JSON.stringify`, not inside quotes of our own. The
   * file is TypeScript that the remote daemon executes, so `name: '${'$'}{project}'`
   * meant a project name containing an apostrophe produced a file that would
   * not parse — and one containing `', evil: …, x: '` produced a file that
   * parsed and did something else. A quote written by us around a value we
   * did not check is the whole bug; `JSON.stringify` writes the quotes and
   * the escaping together, which is why it cannot be got wrong the same way.
   *
   * The project name is also validated as a path segment before this is
   * reached, so this is the second of two locks on the same door.
   */
  private generateSlaveConfig(masterHost: string, masterPort: number, slavePort: number, project: string): string {
    const q = (v: string): string => JSON.stringify(v);
    return `/**
 * Omnitron Slave Configuration
 * Auto-generated by master during remote/cluster deployment.
 * Project: ${JSON.stringify(project)}
 */
export default {
  name: ${q(project)},
  apps: [],
  role: 'slave',
  master: { host: ${q(masterHost)}, port: ${masterPort} },
  sync: {
    interval: 30000,
    batchSize: 1000,
  },
  daemon: {
    socketPath: '~/.omnitron/daemon.sock',
    port: ${slavePort},
    host: '0.0.0.0',
    httpPort: 9800,
    pidFile: '~/.omnitron/daemon.pid',
    stateFile: '~/.omnitron/daemon.state',
  },
  supervision: {
    strategy: 'one_for_one',
    maxRestarts: 10,
    window: 60000,
    backoff: { type: 'exponential', initial: 1000, max: 30000, factor: 2 },
  },
  monitoring: {
    healthCheck: { interval: 30000, timeout: 10000 },
    metrics: { interval: 15000, retention: 86400000 },
  },
  logging: {
    level: 'info',
    directory: '~/.omnitron/logs',
    maxSize: '50m',
    maxFiles: 10,
    compress: false,
  },
  env: 'production',
};
`;
  }

  // ===========================================================================
  // Private — SSH Operations
  // ===========================================================================

  private async verifySSH(node: IStackNode): Promise<void> {
    await this.sshExec(node, 'echo ok', 10_000);
  }

  private async sshExec(node: IStackNode, command: string, timeout = 60_000): Promise<string> {
    const sshArgs = this.buildSSHArgs(node);
    sshArgs.push(command);

    const { stdout } = await exec('ssh', sshArgs, { timeout });
    return stdout.trim();
  }

  private async scpTransfer(node: IStackNode, localPath: string, remotePath: string): Promise<void> {
    const user = node.ssh?.user ?? 'root';
    const port = node.ssh?.port ?? 22;

    const scpArgs: string[] = [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=10',
      '-P', String(port),
    ];

    if (node.ssh?.privateKey) {
      scpArgs.push('-i', node.ssh.privateKey);
    }

    // The remote half of an scp target is expanded by a shell on the remote
    // side, so it needs the same quoting as anything passed to `sshExec`.
    // The local half does not — `execFile` runs scp without a shell.
    scpArgs.push(localPath, `${user}@${node.host}:${shellEscape(remotePath)}`);

    await exec('scp', scpArgs, { timeout: 300_000 }); // 5 min for large artifacts
  }

  private async signalRemoteDaemon(node: IStackNode, appName: string): Promise<void> {
    try {
      // Try RPC restart via omnitron CLI on remote
      await this.sshExec(node, `omnitron restart ${shellEscape(appName)} 2>/dev/null || true`);
    } catch {
      // Non-critical — daemon may not be running
      this.logger.debug({ host: node.host, app: appName }, 'Remote daemon restart signal failed');
    }
  }

  private async verifyHealth(node: IStackNode, appName: string): Promise<void> {
    // Simple health check: ping remote daemon and check app status
    try {
      const status = await this.sshExec(node, `omnitron status --json 2>/dev/null || echo "{}"`, 15_000);
      const parsed = JSON.parse(status);
      if (parsed?.apps) {
        const app = (parsed.apps as any[]).find((a: any) => a.name === appName);
        if (app?.status === 'online') return;
      }
    } catch {
      // Health check is best-effort
    }
  }

  private buildSSHArgs(node: IStackNode): string[] {
    const user = node.ssh?.user ?? 'root';
    const port = node.ssh?.port ?? 22;

    const args: string[] = [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=10',
      '-o', 'BatchMode=yes',
      '-p', String(port),
    ];

    if (node.ssh?.privateKey) {
      args.push('-i', node.ssh.privateKey);
    }

    args.push(`${user}@${node.host}`);
    return args;
  }

  // ===========================================================================
  // Private — Progress
  // ===========================================================================

  private emitProgress(node: string, app: string, status: DeployStatus, progress: number, message: string): void {
    const event: DeployProgress = { node, app, status, progress, message };
    for (const handler of this.progressHandlers) {
      try {
        handler(event);
      } catch {
        // Handler failure must not break deployment
      }
    }
  }
}
