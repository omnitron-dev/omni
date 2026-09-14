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
 *
 * NEVER EXECUTED, as of 2026-09-14. Measured rather than assumed: no log in
 * `~/.omnitron/logs` carries a single line this class emits ("Starting
 * deployment to node", "Slave provisioned", "Deployment successful"), no
 * artifact directory exists, and — decisively — no project config declares
 * `stacks.nodes`, which `startRemoteStack` requires before it can reach here.
 * So both entry points are unreachable in every current configuration.
 *
 * This matters to anyone reading the code below and taking it for a working
 * path. It is careful code — arguments are quoted, path segments validated,
 * heredocs replaced with base64 — and none of that has ever met a real host.
 * Its first run will be its first test. Treat a green read of this file as
 * evidence about intent, not about behaviour.
 *
 * The first thing that first run found, 2026-09-14: **it could not log in.**
 * Every command here went through `ssh -o BatchMode=yes` with an optional
 * `-i <keyfile>`, and `BatchMode=yes` disables every interactive method —
 * password and key passphrase both. The console's Add Node dialog collects
 * exactly those, encrypts them in the daemon's vault, and the health monitor
 * uses them through `ExecutionService.ssh()` on every check round. So the
 * product had two SSH implementations: one that can present what the operator
 * gave it, and one — this — that cannot, on the path where it matters most.
 *
 * Measured against the test host, whose SSH answers a password in 311 ms:
 *
 *   ssh -o BatchMode=yes root@<host> 'echo ok'
 *   → root@<host>: Permission denied (publickey,password).
 *
 * That is the answer to "why can a machine added in the console not be
 * deployed to": not policy, not a missing feature — the deployer could not
 * authenticate as the operator had arranged. It goes through the same
 * `ExecutionService` as the checks now, and takes a `DeployTarget` carrying
 * the credentials rather than an `IStackNode` whose `ISSHConfig` has nowhere
 * to put them.
 */

import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { IStackNode } from '../config/types.js';
import type { ArtifactInfo } from '../project/artifact-builder.js';
import type { ExecutionService, SSHTarget } from '../execution/execution.service.js';

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

/**
 * A machine this deployer can reach, and how.
 *
 * `IStackNode` cannot be this: its `ISSHConfig` holds `user`, `port` and
 * `privateKey`, so a node whose credential is a password — the console's
 * default, and what the operator is offered first — has nowhere to be
 * expressed. Both registries project into this one shape:
 * `stackNodeToDeployTarget` for a node declared in a project's `stacks.nodes`,
 * and `NodeManagerService.nodeToDeployTarget` for one an operator registered
 * in the console, which resolves its secrets from the vault on the way.
 */
export interface DeployTarget {
  host: string;
  /**
   * SSH port. Default 22.
   *
   * Spelled out rather than inherited as `port` from `SSHTarget`, because the
   * other port on this type is the daemon's and both are numbers. An
   * `IStackNode` — whose `port` IS the daemon's — is structurally assignable
   * to any type whose only required field is `host`, so inheriting `port`
   * meant a node passed by mistake would have its daemon port dialled as SSH,
   * and the compiler would agree. With the field named for what it is, the
   * same mistake reaches SSH's default instead of the wrong number.
   */
  sshPort?: number;
  username?: string;
  /** Path to a private key file, read by the SSH engine. */
  privateKey?: string;
  /** Passphrase for that key, resolved from the vault by the caller. */
  passphrase?: string;
  /** SSH password, resolved from the vault by the caller. */
  password?: string;
  /** Omnitron daemon (fleet) port on this node. Default 9700. */
  daemonPort?: number;
  /** Restrict deployment to these apps; absent means every app. */
  apps?: string[];
  /** What to call this node in logs and progress events. */
  label?: string;
}

/** The credentials half, in the shape `ExecutionService` takes. */
function sshTargetOf(target: DeployTarget): SSHTarget {
  const ssh: SSHTarget = { host: target.host };
  if (target.sshPort != null) ssh.port = target.sshPort;
  if (target.username) ssh.username = target.username;
  if (target.privateKey) ssh.privateKey = target.privateKey;
  if (target.passphrase) ssh.passphrase = target.passphrase;
  if (target.password) ssh.password = target.password;
  return ssh;
}

/** Project a node declared in a project config into a deploy target. */
export function stackNodeToDeployTarget(node: IStackNode): DeployTarget {
  const target: DeployTarget = { host: node.host };
  if (node.port != null) target.daemonPort = node.port;
  if (node.ssh?.port != null) target.sshPort = node.ssh.port;
  if (node.ssh?.user) target.username = node.ssh.user;
  // A path, read by the engine. `ISSHConfig` has no passphrase field, so a
  // key declared here must be one that needs none — which is worth knowing
  // when a deployment from a config fails and the same node works from the
  // console.
  if (node.ssh?.privateKey) target.privateKey = node.ssh.privateKey;
  if (node.apps) target.apps = node.apps;
  if (node.label) target.label = node.label;
  return target;
}

/** What an operator has authorised a provisioning run to change on a host. */
export interface ProvisionOptions {
  /**
   * Allow installing a Node.js runtime when the node has none.
   *
   * Off by default. Installing one adds a vendor package repository and runs
   * a package-manager install as root — a durable change to how the machine
   * gets its software, on a machine that is very likely doing something else
   * already.
   */
  installRuntime?: boolean;
}

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
    private readonly execution: ExecutionService,
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
    target: DeployTarget,
    artifact: ArtifactInfo,
    project: string,
  ): Promise<DeployResult> {
    const startTime = Date.now();
    const nodeKey = `${target.host}:${target.daemonPort ?? 9700}`;

    this.logger.info(
      { node: nodeKey, app: artifact.app, version: artifact.version },
      'Starting deployment to node'
    );

    try {
      // 1. Verify SSH connectivity
      this.emitProgress(nodeKey, artifact.app, 'pending', 0, 'Connecting via SSH...');
      await this.verifySSH(target);

      // 2. Ensure remote directory structure
      const remotePath =
        `/opt/omnitron/artifacts/${assertRemotePathSegment('project name', project)}` +
        `/${assertRemotePathSegment('app name', artifact.app)}` +
        `/${assertRemotePathSegment('version', artifact.version)}`;
      await this.sshExec(target, `mkdir -p ${shellEscape(remotePath)}`);

      // 3. Transfer artifact
      this.emitProgress(nodeKey, artifact.app, 'transferring', 20, 'Transferring artifact...');
      const remoteFile = `${remotePath}/${artifact.app}-${artifact.version}.tar.gz`;
      await this.scpTransfer(target, artifact.path, remoteFile);

      // 4. Extract on remote
      this.emitProgress(nodeKey, artifact.app, 'extracting', 50, 'Extracting artifact...');
      await this.sshExec(target, `cd ${shellEscape(remotePath)} && tar -xzf ${shellEscape(`${artifact.app}-${artifact.version}.tar.gz`)}`);

      // 5. Install production dependencies
      this.emitProgress(nodeKey, artifact.app, 'extracting', 65, 'Installing dependencies...');
      await this.sshExec(target, `cd ${shellEscape(remotePath)} && npm install --production --ignore-scripts 2>/dev/null || true`);

      // 6. Signal remote daemon to restart the app
      this.emitProgress(nodeKey, artifact.app, 'restarting', 80, 'Restarting app on remote...');
      await this.signalRemoteDaemon(target, artifact.app);

      // 7. Verify health
      this.emitProgress(nodeKey, artifact.app, 'verifying', 90, 'Verifying health...');
      await this.verifyHealth(target, artifact.app);

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
    targets: DeployTarget[],
    artifacts: ArtifactInfo[],
    project: string,
    options?: { concurrency?: number },
  ): Promise<DeployResult[]> {
    const concurrency = options?.concurrency ?? 3;
    const results: DeployResult[] = [];

    // Build deployment matrix: each app to each node (or node-specific apps)
    const tasks: Array<{ target: DeployTarget; artifact: ArtifactInfo }> = [];
    for (const target of targets) {
      for (const artifact of artifacts) {
        // If node has explicit app list, only deploy matching apps
        if (target.apps && !target.apps.includes(artifact.app)) continue;
        tasks.push({ target, artifact });
      }
    }

    // Execute with concurrency limit
    const executing = new Set<Promise<void>>();
    for (const task of tasks) {
      const promise = (async () => {
        const result = await this.deployToNode(task.target, task.artifact, project);
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
    target: DeployTarget,
    masterHost: string,
    masterPort: number,
    project: string,
    options: ProvisionOptions = {},
  ): Promise<boolean> {
    const nodeKey = `${target.host}:${target.daemonPort ?? 9700}`;

    try {
      // 1. Verify SSH access
      this.emitProgress(nodeKey, '*', 'pending', 0, 'Connecting via SSH...');
      await this.verifySSH(target);

      // 2. Ensure runtime (Node.js or Bun)
      this.emitProgress(nodeKey, '*', 'extracting', 10, 'Checking runtime...');
      // No `.catch(() => '')`. The remote command already answers "absent"
      // with an empty string — that is what the `|| echo ""` is for — so
      // swallowing an SSH failure here converts "could not ask the host"
      // into "the host has no runtime", and the next line acts on it by
      // running `curl | bash` and a package-manager install against a host
      // that very likely already has Node. Step 1 above treats SSH failure
      // as failure; so does the install below. These two probes were the
      // only places that did not.
      const hasNode = await this.sshExec(target, 'which node 2>/dev/null || which bun 2>/dev/null || echo ""');
      if (!hasNode.trim()) {
        // Installing a runtime means adding a vendor's APT or YUM repository
        // to the machine, importing its signing key, and running a
        // package-manager install as root. That is a durable change to how the
        // host gets its software, and it is not what an operator asked for
        // when they asked for a slave.
        //
        // The machines this reaches are not blank. The host this path was
        // first run against — a test box, offered as one — turned out to be
        // running a Monero node, a Tor daemon and two VPN containers, with an
        // uptime of 599 days. `curl … | bash -` as root on that is a decision
        // with an owner, and the owner is not this function.
        //
        // So it asks. The message names the exact commands, because "enable
        // installRuntime" without them is a checkbox rather than consent.
        if (!options.installRuntime) {
          this.logger.error(
            { host: target.host },
            'No Node.js or Bun on the node, and installing one was not authorised',
          );
          this.emitProgress(
            nodeKey, '*', 'failed', 0,
            `${target.host} has no Node.js or Bun. Installing one would add a vendor package repository ` +
              `(nodesource) and run a package-manager install as root. Install a runtime yourself, or ` +
              `re-run with installRuntime enabled to authorise that.`,
          );
          return false;
        }
        this.logger.warn(
          { host: target.host },
          'Installing Node.js on the remote node — this adds a vendor package repository',
        );
        this.emitProgress(nodeKey, '*', 'extracting', 15, 'Installing Node.js...');
        try {
          // Install Node.js via official installer (works on most Linux distros)
          await this.sshExec(target, 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs 2>/dev/null || (curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - && yum install -y nodejs) 2>/dev/null || (apk add --no-cache nodejs npm)', 120_000);
        } catch (err) {
          this.logger.error({ host: target.host, error: (err as Error).message }, 'Failed to install Node.js');
          return false;
        }
      }

      // 3. Install omnitron
      this.emitProgress(nodeKey, '*', 'extracting', 30, 'Installing omnitron...');
      // As above: an unreachable host must not read as "omnitron is missing".
      const hasOmnitron = await this.sshExec(target, 'which omnitron 2>/dev/null || echo ""');
      if (!hasOmnitron.trim()) {
        try {
          await this.sshExec(target, 'npm install -g @omnitron-dev/omnitron', 120_000);
        } catch (err) {
          this.logger.error({ host: target.host, error: (err as Error).message }, 'Failed to install omnitron');
          return false;
        }
      }

      // 4. Generate slave config
      this.emitProgress(nodeKey, '*', 'extracting', 50, 'Configuring slave daemon...');
      const configDir = '/etc/omnitron';
      // Validated here as well as in `deployToNode`: this path provisions a
      // slave without going through artifact deployment first.
      assertRemotePathSegment('project name', project);
      const configContent = this.generateSlaveConfig(masterHost, masterPort, target.daemonPort ?? 9700, project);
      await this.sshExec(target, `mkdir -p ${shellEscape(configDir)}`);
      await this.sshExec(target, writeRemoteFileCommand(`${configDir}/omnitron.config.ts`, configContent));

      // 5. Start slave daemon (or restart if already running)
      this.emitProgress(nodeKey, '*', 'restarting', 70, 'Starting slave daemon...');
      await this.sshExec(target, `cd ${shellEscape(configDir)} && (omnitron down 2>/dev/null; omnitron up) &`).catch(() => {
        // Background start — may "fail" because SSH returns before daemon fully starts
      });

      // 6. Wait briefly and verify daemon is running
      this.emitProgress(nodeKey, '*', 'verifying', 90, 'Verifying slave daemon...');
      await new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        const pingResult = await this.sshExec(target, 'omnitron ping 2>/dev/null || echo "unreachable"', 10_000);
        if (pingResult.includes('unreachable')) {
          this.logger.warn({ host: target.host }, 'Slave daemon not yet responding — may still be starting');
        }
      } catch {
        this.logger.warn({ host: target.host }, 'Could not verify slave daemon — it may still be starting');
      }

      this.emitProgress(nodeKey, '*', 'success', 100, 'Slave provisioned');
      this.logger.info({ host: target.host, masterHost, masterPort }, 'Slave node provisioned');
      return true;
    } catch (err) {
      this.emitProgress(nodeKey, '*', 'failed', 0, (err as Error).message);
      this.logger.error({ host: target.host, error: (err as Error).message }, 'Failed to provision slave node');
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

  private async verifySSH(target: DeployTarget): Promise<void> {
    await this.sshExec(target, 'echo ok', 10_000);
  }

  /**
   * Run a command on the node, through the daemon's one SSH implementation.
   *
   * Throws on a non-zero exit, which is what the callers above are written
   * against — they use `|| echo ""` where they want to see a failure as an
   * answer, and expect a throw everywhere else. `ExecutionService.ssh` reports
   * failure in `exitCode` rather than raising, so the check has to be here;
   * without it every `if (!result.trim())` in this file would read a failed
   * command as an empty answer, and the two probes in `provisionSlaveNode`
   * would install a runtime onto a host that already has one.
   */
  private async sshExec(target: DeployTarget, command: string, timeout = 60_000): Promise<string> {
    const result = await this.execution.ssh(sshTargetOf(target), command, { timeout });
    if (result.exitCode !== 0) {
      const detail = result.stderr || result.stdout || `exit ${result.exitCode}`;
      throw new Error(`ssh ${target.username ?? 'root'}@${target.host}: ${detail}`);
    }
    return result.stdout.trim();
  }

  private async scpTransfer(target: DeployTarget, localPath: string, remotePath: string): Promise<void> {
    await this.execution.uploadFile(sshTargetOf(target), localPath, remotePath);
  }

  private async signalRemoteDaemon(target: DeployTarget, appName: string): Promise<void> {
    try {
      // Try RPC restart via omnitron CLI on remote
      await this.sshExec(target, `omnitron restart ${shellEscape(appName)} 2>/dev/null || true`);
    } catch {
      // Non-critical — daemon may not be running
      this.logger.debug({ host: target.host, app: appName }, 'Remote daemon restart signal failed');
    }
  }

  private async verifyHealth(target: DeployTarget, appName: string): Promise<void> {
    // Simple health check: ping remote daemon and check app status
    try {
      const status = await this.sshExec(target, `omnitron status --json 2>/dev/null || echo "{}"`, 15_000);
      const parsed = JSON.parse(status);
      if (parsed?.apps) {
        const app = (parsed.apps as any[]).find((a: any) => a.name === appName);
        if (app?.status === 'online') return;
      }
    } catch {
      // Health check is best-effort
    }
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
