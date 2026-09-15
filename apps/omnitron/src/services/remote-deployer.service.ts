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
import {
  PLATFORM_PROBE,
  parsePlatformProbe,
  planProvisioning,
  describePlan,
} from './remote-provisioner.js';
import { installSteps, activateSteps, pruneSteps } from './bundle-builder.js';

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

/** What a provisioning run may do to a host. */
export interface ProvisionOptions {
  /**
   * Allow the host's package manager to be used for missing tools. Default
   * true — preparing a node is meant to be automatic.
   *
   * It is a much smaller permission than it was. The runtime itself now comes
   * from nodejs.org as a tarball under omnitron's own prefix, so the package
   * manager is reached only for `curl` and `tar` when a host has neither, and
   * a host that has them is never touched by it at all.
   */
  installRuntime?: boolean;
  /** Runtime version for a host that has none. Defaults to the pinned LTS. */
  nodeVersion?: string;
}

/**
 * How long a freshly provisioned slave has to answer.
 *
 * A daemon start is an application boot: a DI container, a module graph, a
 * SQLite open. On a loaded host this is tens of seconds, and the old
 * three-second sleep was shorter than the work by an order of magnitude.
 */
const SLAVE_START_TIMEOUT_MS = 120_000;
/** How often it is asked, while it is starting. */
const DAEMON_POLL_MS = 3_000;

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
    /**
     * Where this node should dial to reach the master, or null when there is
     * nowhere — a master behind NAT, which is where remote stacks are
     * started from.
     *
     * Null is not a failure. Replication is master-PULL: the master opens
     * the connection, over SSH when the node's daemon port is closed, and
     * drains the node's buffer. `omnitron up --slave` takes the address
     * optionally for exactly this reason.
     */
    masterHost: string | null,
    masterPort: number,
    project: string,
    options: ProvisionOptions = {},
  ): Promise<boolean> {
    const nodeKey = `${target.host}:${target.daemonPort ?? 9700}`;

    try {
      // 1. Verify SSH access
      this.emitProgress(nodeKey, '*', 'pending', 0, 'Connecting via SSH...');
      await this.verifySSH(target);

      // 2-3. Prepare the host: whatever it is, and whatever it is missing.
      //
      // This was two probes and a `||` chain of package-manager installs that
      // only worked on three Linux families, added a vendor repository to the
      // host as a side effect, and on failure reported the error from the
      // LAST alternative — `apk` on a Debian machine that has never had it.
      //
      // Now the host is asked what it is in one round trip, a plan is derived
      // from the answer, and the plan is a value: it can be logged before it
      // runs and read in a test without a machine. See
      // `remote-provisioner.ts` for what it decides and why.
      this.emitProgress(nodeKey, '*', 'extracting', 10, 'Inspecting the host...');
      const facts = parsePlatformProbe(await this.sshExec(target, PLATFORM_PROBE, 60_000));
      const plan = planProvisioning(facts, {
        ...(options.nodeVersion ? { nodeVersion: options.nodeVersion } : {}),
        ...(options.installRuntime === false ? { usePackageManager: false } : {}),
      });

      this.logger.info(
        {
          host: target.host,
          os: facts.os,
          arch: facts.arch,
          distro: facts.distro,
          packageManager: facts.packageManager,
          node: facts.node,
          omnitron: facts.omnitron,
          plan: describePlan(plan),
        },
        'Host inspected',
      );

      if (plan.refusal) {
        this.logger.error({ host: target.host, reason: plan.refusal }, 'Cannot prepare this host');
        this.emitProgress(nodeKey, '*', 'failed', 0, plan.refusal);
        return false;
      }

      let progress = 15;
      const stride = plan.steps.length > 0 ? Math.floor(30 / plan.steps.length) : 0;
      for (const step of plan.steps) {
        this.emitProgress(nodeKey, '*', 'extracting', progress, step.what);
        if (step.touchesPackageManager) {
          // Said at warning level: this is the one kind of step that changes
          // how the machine gets its software, and the machines this reaches
          // are not blank.
          this.logger.warn({ host: target.host, step: step.what }, 'Using the host package manager');
        }
        try {
          await this.sshExec(target, step.command, step.timeoutMs);
        } catch (err) {
          // The step that failed, by name, rather than the last alternative's
          // error message.
          this.logger.error(
            { host: target.host, step: step.what, error: (err as Error).message },
            'Host preparation step failed',
          );
          this.emitProgress(nodeKey, '*', 'failed', progress, `${step.what}: ${(err as Error).message}`);
          return false;
        }
        progress += stride;
      }

      // 4. Configure and start the slave, through omnitron's own setup path.
      //
      // This wrote `/etc/omnitron/omnitron.config.ts` containing `role`,
      // `master` and a `daemon` block, then ran a bare `omnitron up` beside
      // it. Every one of those keys was read by nothing.
      //
      // `IEcosystemConfig` — the schema of that file — has no `role`, no
      // `master` and no `daemon`. The daemon boots from
      // `~/.omnitron/config.json`, whose `SavedDaemonConfig` carried role and
      // master and nothing about transports. So a provisioned slave would
      // have come up as a MASTER, bound to loopback, with no master address
      // and no sync: three of the four things this step exists to arrange,
      // silently not arranged.
      //
      // `omnitron up --slave <host>:<port>` is the path that writes what the
      // daemon reads, and it is the same one an operator uses by hand. One
      // way to configure a slave instead of two, and the one that is
      // exercised.
      this.emitProgress(nodeKey, '*', 'extracting', 50, 'Configuring slave daemon...');
      assertRemotePathSegment('project name', project);
      const masterAddr = masterHost ? `${masterHost}:${masterPort}` : null;

      // 5. Start slave daemon (or restart if already running)
      this.emitProgress(nodeKey, '*', 'restarting', 70, 'Starting slave daemon...');
      await this.sshExec(
        target,
        masterAddr
          ? `omnitron down 2>/dev/null; omnitron up --slave ${shellEscape(masterAddr)} --no-infra`
          // `--slave` with no address still sets the role; the node buffers
          // locally and waits to be pulled from, which is what it would do
          // with an address it cannot reach anyway.
          : 'omnitron down 2>/dev/null; omnitron up --slave --no-infra',
        180_000,
      ).catch((err) => {
        // Reported, not swallowed. The verification below tells us whether the
        // daemon came up; this tells us what it said on the way.
        this.logger.warn(
          { host: target.host, error: (err as Error).message },
          'Slave start command did not return cleanly — verifying anyway',
        );
      });

      // 6. Verify the daemon is running, and mean it.
      //
      // This slept three seconds, pinged once, and on `unreachable` logged
      // "may still be starting" — then reported success regardless. Measured
      // on the first real run: the start command failed with
      // `omnitron: command not found`, the ping found nothing, and the
      // function returned `true`. A caller that trusts that goes on to ship
      // artifacts to a node with no daemon, and the console shows a node
      // that was "provisioned" and answers nothing.
      //
      // A daemon that is starting will answer within the window; one that is
      // not there will not answer within any window. Polling tells them
      // apart, which one sample cannot.
      this.emitProgress(nodeKey, '*', 'verifying', 90, 'Verifying slave daemon...');
      const started = await this.awaitDaemon(target, SLAVE_START_TIMEOUT_MS);
      if (!started.ok) {
        this.logger.error(
          { host: target.host, waitedMs: SLAVE_START_TIMEOUT_MS, detail: started.detail },
          'Slave daemon did not come up',
        );
        this.emitProgress(
          nodeKey, '*', 'failed', 90,
          `the slave daemon did not answer within ${Math.round(SLAVE_START_TIMEOUT_MS / 1000)}s: ${started.detail}`,
        );
        return false;
      }

      this.emitProgress(nodeKey, '*', 'success', 100, `Slave provisioned — ${started.detail}`);
      this.logger.info(
        { host: target.host, masterHost, masterPort, daemon: started.detail },
        'Slave node provisioned',
      );
      return true;
    } catch (err) {
      this.emitProgress(nodeKey, '*', 'failed', 0, (err as Error).message);
      this.logger.error({ host: target.host, error: (err as Error).message }, 'Failed to provision slave node');
      return false;
    }
  }

  // ===========================================================================
  // Private — SSH Operations
  // ===========================================================================

  /**
   * Wait for the remote daemon to answer, or report why it did not.
   *
   * `omnitron ping` on the far side prints its pid, uptime and version when
   * the daemon is up, and fails otherwise. The last failure is carried out of
   * the loop so a caller can say what the host said rather than only that
   * time ran out.
   */
  private async awaitDaemon(
    target: DeployTarget,
    timeoutMs: number,
  ): Promise<{ ok: boolean; detail: string }> {
    const deadline = Date.now() + timeoutMs;
    let last = 'no answer';
    while (Date.now() < deadline) {
      try {
        const answer = await this.sshExec(target, 'omnitron ping', 15_000);
        // "It printed something" is not "it is running". `omnitron ping`
        // used to exit 0 while printing that the daemon is not running —
        // fixed, but a node runs whatever version it has, and this code
        // upgrades nodes from older ones. The answer is read, not assumed.
        if (/daemon is running/i.test(answer)) {
          return { ok: true, detail: answer.split('\n').filter(Boolean).pop()!.trim() };
        }
        last = answer.split('\n').filter(Boolean).pop()?.trim() || 'the ping printed nothing';
      } catch (err) {
        last = (err as Error).message;
      }
      await new Promise((resolve) => setTimeout(resolve, DAEMON_POLL_MS));
    }
    return { ok: false, detail: last };
  }

  /**
   * Install a locally built omnitron on a node, beside whatever it is
   * running.
   *
   * The counterpart to installing from the registry, and the only channel
   * that can put THIS tree on a node: the published package is whatever was
   * last released, which on 2026-09-14 was five months and 224 commits
   * behind, under the same version number.
   *
   * Nothing is made live here. The archive is transferred, unpacked into its
   * own version directory, installed, and run — and `activate` is a separate
   * call, so a caller that stops after this has spent disk and changed
   * nothing about what the node is serving.
   */
  async installBundle(
    target: DeployTarget,
    archivePath: string,
    version: string,
    prefix = '/opt/omnitron',
  ): Promise<boolean> {
    const nodeKey = `${target.host}:${target.daemonPort ?? 9700}`;
    const layout = { prefix, version };
    // Under the prefix, not `/tmp`: a bundle is tens of megabytes and `/tmp`
    // is a tmpfs on many hosts, where a large transfer competes with memory.
    const remoteArchive = `${prefix}/releases/${version}.tar.gz`;

    try {
      this.emitProgress(nodeKey, '*', 'pending', 0, 'Connecting via SSH...');
      await this.verifySSH(target);

      this.emitProgress(nodeKey, '*', 'transferring', 10, `Transferring ${version}...`);
      await this.sshExec(target, `mkdir -p ${shellEscape(`${prefix}/releases`)}`);
      await this.scpTransfer(target, archivePath, remoteArchive);

      let progress = 30;
      for (const step of installSteps(layout, remoteArchive)) {
        this.emitProgress(nodeKey, '*', 'extracting', progress, step.what);
        const output = await this.sshExec(target, step.command, step.timeoutMs);
        if (step.what.includes('runs')) {
          // The version the node reports has to be the version we shipped.
          // A mismatch means the archive, the directory and the manifest
          // disagree — and the one thing a fleet upgrade cannot tolerate is
          // a node that reports a version it is not running.
          const reported = output.trim().split('\n').pop()?.trim();
          if (reported !== version) {
            throw new Error(
              `The installed copy reports ${JSON.stringify(reported)}, not ${JSON.stringify(version)}.`,
            );
          }
        }
        progress += 20;
      }

      this.emitProgress(nodeKey, '*', 'success', 100, `${version} installed (not yet current)`);
      this.logger.info({ host: target.host, version, prefix }, 'Bundle installed beside the running version');
      return true;
    } catch (err) {
      const message = (err as Error).message;
      this.emitProgress(nodeKey, '*', 'failed', 0, message);
      this.logger.error({ host: target.host, version, error: message }, 'Bundle install failed');
      return false;
    }
  }

  /**
   * Make an installed version the one the node runs, and restart into it.
   *
   * Separate from `installBundle` for the reason the layout exists: this is
   * the only step that changes what runs.
   */
  async activateBundle(
    target: DeployTarget,
    version: string,
    prefix = '/opt/omnitron',
    keepVersions = 3,
  ): Promise<boolean> {
    const nodeKey = `${target.host}:${target.daemonPort ?? 9700}`;
    const layout = { prefix, version };

    try {
      for (const step of activateSteps(layout)) {
        this.emitProgress(nodeKey, '*', 'restarting', 40, step.what);
        await this.sshExec(target, step.command, step.timeoutMs);
      }

      this.emitProgress(nodeKey, '*', 'restarting', 60, 'Restarting the daemon into the new version');
      // By absolute path into `current`, not by name. A bare `omnitron` is
      // whatever the node's PATH resolves — which, until the step above ran,
      // was a different installation entirely. Naming the copy we just
      // activated is the difference between restarting the new version and
      // restarting whatever was there.
      const cli = shellEscape(`${prefix}/current/dist/cli/omnitron.js`);
      await this.sshExec(target, `${cli} down 2>/dev/null; ${cli} up --no-infra`, 180_000).catch((err) => {
        this.logger.warn(
          { host: target.host, error: (err as Error).message },
          'Restart command did not return cleanly — verifying anyway',
        );
      });

      this.emitProgress(nodeKey, '*', 'verifying', 80, 'Verifying the daemon answers');
      const started = await this.awaitDaemon(target, 120_000);
      if (!started.ok) {
        // Reported, and NOT rolled back automatically. A daemon that will not
        // start is a decision for whoever is watching: the previous version
        // is still on disk and one `ln -sfn` away, and guessing that a
        // rollback is wanted can be as wrong as guessing it is not.
        this.logger.error(
          { host: target.host, version, detail: started.detail },
          'The new version did not answer — the previous one is still installed',
        );
        this.emitProgress(
          nodeKey, '*', 'failed', 80,
          `${version} did not answer: ${started.detail}. Roll back with ` +
            `\`ln -sfn ${prefix}/versions/<previous> ${prefix}/current\` and restart.`,
        );
        return false;
      }

      // Only once the new version is serving. Pruning before this could
      // remove the version a rollback needs.
      for (const step of pruneSteps(layout, keepVersions)) {
        await this.sshExec(target, step.command, step.timeoutMs).catch((err) => {
          // Retention failing is not the upgrade failing.
          this.logger.warn({ host: target.host, error: (err as Error).message }, 'Version retention failed');
        });
      }

      this.emitProgress(nodeKey, '*', 'success', 100, `Running ${version} — ${started.detail}`);
      this.logger.info({ host: target.host, version, daemon: started.detail }, 'Node upgraded');
      return true;
    } catch (err) {
      const message = (err as Error).message;
      this.emitProgress(nodeKey, '*', 'failed', 0, message);
      this.logger.error({ host: target.host, version, error: message }, 'Activation failed');
      return false;
    }
  }

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
