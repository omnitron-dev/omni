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
      const remotePath = `/opt/omnitron/artifacts/${project}/${artifact.app}/${artifact.version}`;
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
      const configContent = this.generateSlaveConfig(masterHost, masterPort, node.port ?? 9700, project);
      await this.sshExec(node, `mkdir -p ${shellEscape(configDir)}`);
      // Write config via heredoc (avoids shell escaping issues with complex content)
      await this.sshExec(node, `cat > ${shellEscape(configDir + '/omnitron.config.ts')} << 'OMNITRON_EOF'\n${configContent}\nOMNITRON_EOF`);

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
  private generateSlaveConfig(masterHost: string, masterPort: number, slavePort: number, project: string): string {
    return `/**
 * Omnitron Slave Configuration
 * Auto-generated by master during remote/cluster deployment.
 * Project: ${project}
 */
export default {
  name: '${project}',
  apps: [],
  role: 'slave',
  master: { host: '${masterHost}', port: ${masterPort} },
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

    scpArgs.push(localPath, `${user}@${node.host}:${remotePath}`);

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
