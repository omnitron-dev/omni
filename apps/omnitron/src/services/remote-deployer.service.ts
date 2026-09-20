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

/**
 * Fill a stack node's connection details from the node registry.
 *
 * A stack says WHICH host an app runs on; the node registry says HOW to
 * reach it — the user, the port, and the key or password, which are held
 * encrypted in the daemon's vault because they are credentials and a config
 * file in a repository is not where those go.
 *
 * Nothing joined the two. `stackNodeToDeployTarget` read only the stack's
 * own `ssh` block, so deploying to a machine that the console had already
 * registered, provisioned and been connected to failed at the first
 * connection:
 *
 *     Invalid SSH options: Either privateKey or password must be provided
 *
 * — for a node the same daemon was, at that moment, holding an SSH tunnel to.
 *
 * The stack's explicit values win where it has them: an operator who wrote
 * `ssh.user` in the stack config meant it, and a registry entry is the
 * default, not an override. Everything the stack leaves out comes from the
 * registry.
 */
export function withNodeCredentials(target: DeployTarget, registered: SSHTarget | null): DeployTarget {
  if (!registered) return target;

  const merged: DeployTarget = { ...target };
  if (merged.sshPort == null && registered.port != null) merged.sshPort = registered.port;
  if (!merged.username && registered.username) merged.username = registered.username;
  if (!merged.privateKey && registered.privateKey) merged.privateKey = registered.privateKey;
  if (!merged.passphrase && registered.passphrase) merged.passphrase = registered.passphrase;
  if (!merged.password && registered.password) merged.password = registered.password;
  return merged;
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

/**
 * What a deployment is doing, for a console watching it.
 *
 * `installing` is its own value because it is the longest phase by a wide
 * margin — `npm install` on the node takes minutes where the transfer takes
 * seconds — and reporting it as `extracting` leaves an operator watching a
 * message that stopped being true.
 */
export type DeployStatus =
  | 'pending'
  | 'transferring'
  | 'extracting'
  | 'installing'
  | 'restarting'
  | 'verifying'
  | 'success'
  | 'failed';

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

/** A progress event with the time it happened, for a console that polls. */
export interface DeployProgressRecord extends DeployProgress {
  /** ISO 8601. */
  at: string;
}

// =============================================================================
// RemoteDeployer
// =============================================================================

export class RemoteDeployer {
  /** Active deployment progress handlers */
  private readonly progressHandlers: Array<(progress: DeployProgress) => void> = [];

  /**
   * The last thing that happened to each app on each node.
   *
   * A deployment publishes progress as it goes and the console polls; without
   * somewhere for an event to WAIT, those two never meet, and a deployment
   * that takes a quarter of an hour showed the operator one row that said
   * `deploying` from beginning to end. Everything that said WHERE it was —
   * transferring, installing, the message naming the failing step — reached a
   * handler that re-emitted it to nobody.
   *
   * Keyed by node and app, so this is bounded by the fleet rather than by how
   * often anyone deploys, and the entry for an app is always its current
   * state rather than a scroll an operator has to read to the end of.
   */
  private readonly lastProgress = new Map<string, DeployProgressRecord>();

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
    options?: {
      /**
       * Whether to start the app once its artifact is in place.
       *
       * False for a stack deployment, which installs everything, writes the
       * app definitions, and only then starts — because a node cannot start
       * an app it has no definition for, and the definitions are written from
       * the set of artifacts that landed.
       */
      startAfterInstall?: boolean;
    },
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

      // 4. Extract on remote, into an empty directory.
      //
      // `tar -xzf` over whatever was there before leaves everything the new
      // archive does not name — and what was there before is a `node_modules`
      // of a different SHAPE. The first deployment after this builder changed
      // put an npm manifest beside a pnpm tree and `npm install` answered
      //
      //     npm error Cannot read properties of null (reading 'edgesOut')
      //
      // which is npm walking a dependency graph through symlinks it did not
      // create. The same reasoning as `installSteps`, which removes the
      // version directory before unpacking for exactly this: an install
      // reconciling against a tree from another tool is not this version.
      //
      // Everything except the archive just uploaded, and only inside the
      // artifact's own version directory — every segment of which was checked
      // by `assertRemotePathSegment` above.
      this.emitProgress(nodeKey, artifact.app, 'extracting', 50, 'Extracting artifact...');
      const archiveName = `${artifact.app}-${artifact.version}.tar.gz`;
      await this.sshExec(
        target,
        `cd ${shellEscape(remotePath)} && ` +
          `find . -mindepth 1 -maxdepth 1 ! -name ${shellEscape(archiveName)} -exec rm -rf {} + && ` +
          `tar -xzf ${shellEscape(archiveName)}`,
      );

      // 5. Install the dependencies ON THE NODE.
      //
      // Three shapes of this step, and the two that were wrong are worth
      // keeping written down because each looked finished.
      //
      // It first ran `npm install --production --ignore-scripts 2>/dev/null
      // || true`. That could not work even once — the manifests use pnpm's
      // `workspace:` protocol, npm answers `EUNSUPPORTEDPROTOCOL` — and the
      // `|| true` meant nobody found out.
      //
      // It then trusted the artifact to arrive complete, from `pnpm deploy`,
      // and checked `test -d node_modules`. The artifact was NOT complete:
      // every `@omnitron-dev/*` package was a symlink into a home directory
      // on the master, twenty-three of them, and a directory of dangling
      // symlinks passes `test -d`. A symlink to `/opt/omnitron/current`
      // patched the one the first import happened to name; the other
      // twenty-two were waiting behind it.
      //
      // Now the artifact carries `vendor/*.tgz` and a manifest that installs
      // them, exactly like the daemon's own bundle, and the install runs
      // here. That is not a cost to be minimised — it is the only step that
      // happens on a machine that knows it is Linux, which is what decides
      // between `@esbuild/darwin-arm64` and `@esbuild/linux-x64`.
      this.emitProgress(nodeKey, artifact.app, 'installing', 60, 'Installing dependencies on the node...');
      try {
        await this.sshExec(
          target,
          `cd ${shellEscape(remotePath)} && npm install --omit=dev --no-audit --no-fund`,
          900_000,
        );
      } catch (err) {
        const duration = Date.now() - startTime;
        const detail = `dependency install failed on the node: ${(err as Error).message.slice(0, 400)}`;
        this.emitProgress(nodeKey, artifact.app, 'failed', 60, detail);
        this.logger.error({ node: nodeKey, app: artifact.app, path: remotePath }, detail);
        return { node: nodeKey, app: artifact.app, version: artifact.version, status: 'failed', duration, error: detail };
      }

      // 5a. One physical copy of every package the daemon shares with the app.
      //
      // A supervised app does not run alone in its process: omnitron's own
      // `bootstrap-process.js` is the entry point, and the app's modules are
      // loaded into it. Titan keeps identities at module scope — the
      // `Container` class among them — so two physical installations of
      // `@omnitron-dev/titan` in one process means `@Inject(Container)`
      // resolves against a class that is not the one the daemon registered,
      // and the failure reads `Dependency 'Container' not found`.
      //
      // `bootstrap-process.ts` checks for exactly this and refuses to start,
      // which is how a freshly installed artifact answered:
      //
      //     Titan package identity mismatch detected between omnitron daemon
      //     and app 'geo'. Daemon resolves @omnitron-dev/titan from
      //     /opt/omnitron/versions/…; App resolves … from /opt/omnitron/
      //     artifacts/daos/geo/0.0.1/node_modules/@omnitron-dev/titan
      //
      // That is the correct refusal, and the answer is not to install less:
      // the vendored copies are what let `npm install` resolve a coherent
      // tree in the first place. They are replaced afterwards by links to
      // the daemon's own, computed ON THE NODE from what the daemon actually
      // has, so the set stays right as the daemon's closure changes rather
      // than being a list here that drifts from it.
      //
      // `@omnitron-dev/omnitron` is deliberately NOT one of them, and this is
      // the second time that lesson has been paid for. The daemon IS that
      // package, so it is not inside its own `node_modules`, and linking to
      // the install root instead gives node a directory whose package.json
      // carries `name`, `version`, `type` and `dependencies` and NO `main`
      // and NO `exports` — `bundleRootManifest` writes an install manifest,
      // not a library manifest. Resolution then falls back to `index.js`,
      // which is not there:
      //
      //     Cannot find package
      //     '.../node_modules/@omnitron-dev/omnitron/index.js'
      //
      // — the exact error this whole line of work started from. The vendored
      // copy that `pnpm pack` produces from `apps/omnitron` has the real
      // manifest, so it is left alone. Its identity is not shared across the
      // process boundary the way titan's is: `defineSystem` returns data that
      // the daemon's bootstrap reads, not a class anything does `instanceof`
      // against.
      //
      // `rm -rf` before each `ln -sfn`: linking onto an existing DIRECTORY
      // puts the link INSIDE it, leaving a directory with no package.json
      // that node reports as a missing `index.js` — a message about a file
      // that was never the problem.
      const daemonRoot = '/opt/omnitron/current';
      await this.sshExec(
        target,
        `set -e; APP=${shellEscape(`${remotePath}/node_modules/@omnitron-dev`)}; ` +
          `mkdir -p "$APP"; ` +
          `for p in ${shellEscape(daemonRoot)}/node_modules/@omnitron-dev/*; do ` +
          `[ -e "$p" ] || continue; n=$(basename "$p"); ` +
          `rm -rf "$APP/$n"; ln -sfn "$p" "$APP/$n"; done`,
      );

      // The install either produced a tree that resolves or it did not, and
      // `test -d node_modules` cannot tell those apart — it was true for the
      // whole time nothing worked. Asking node to RESOLVE the package the
      // app imports first is the smallest question with a real answer.
      //
      // The package, not a file inside it: my first version of this resolved
      // `@omnitron-dev/omnitron/package.json` and a correct install answered
      // `ERR_PACKAGE_PATH_NOT_EXPORTED`, because a package with an `exports`
      // map publishes what it lists and nothing else. A probe that fails on
      // a healthy tree is worse than none — it would have failed every
      // deployment from here on, for the one reason that is not a fault.
      this.emitProgress(nodeKey, artifact.app, 'extracting', 70, 'Checking dependencies...');
      const resolved = await this.sshExec(
        target,
        `cd ${shellEscape(remotePath)} && node -e ${shellEscape(
          "const r=require('module').createRequire(process.cwd()+'/package.json');" +
            "r.resolve('@omnitron-dev/omnitron');r.resolve('@omnitron-dev/titan')",
        )} >/dev/null 2>&1 && echo resolves || echo broken`,
      ).catch(() => 'broken');
      if (resolved.trim() !== 'resolves') {
        const duration = Date.now() - startTime;
        const detail =
          'the installed tree cannot resolve @omnitron-dev/omnitron or @omnitron-dev/titan, ' +
          'so the app will fail at its first import';
        this.emitProgress(nodeKey, artifact.app, 'failed', 70, detail);
        this.logger.error({ node: nodeKey, app: artifact.app, path: remotePath }, detail);
        return { node: nodeKey, app: artifact.app, version: artifact.version, status: 'failed', duration, error: detail };
      }

      // 6. Installed. Starting is a SEPARATE phase, and the order matters:
      // a node cannot start an app it has no definition for, and the
      // definitions are written once all the artifacts have landed. Starting
      // here made the two mutually exclusive — the restart failed with
      // `Unknown app`, the result was marked failed, and the registration,
      // which only writes apps whose deployment succeeded, wrote nothing.
      if (options?.startAfterInstall === false) {
        const duration = Date.now() - startTime;
        this.emitProgress(nodeKey, artifact.app, 'success', 75, 'Installed');
        return { node: nodeKey, app: artifact.app, version: artifact.version, status: 'success', duration };
      }

      this.emitProgress(nodeKey, artifact.app, 'restarting', 80, 'Restarting app on remote...');
      const started = await this.signalRemoteDaemon(target, artifact.app);

      // 7. Verify health
      this.emitProgress(nodeKey, artifact.app, 'verifying', 90, 'Verifying health...');
      const health = await this.verifyHealth(target, artifact.app);

      const duration = Date.now() - startTime;

      // An artifact on disk is not a running application. Reporting success
      // for the transfer alone is what let a fleet show six deployed apps and
      // run none of them.
      if (!started.ok || !health.online) {
        const why = !started.ok ? started.detail : health.detail;
        this.emitProgress(nodeKey, artifact.app, 'failed', 90, `artifact installed, app not running: ${why}`);
        this.logger.error(
          { node: nodeKey, app: artifact.app, version: artifact.version, duration, detail: why },
          'Artifact installed, but the app is not running on the node',
        );
        return {
          node: nodeKey,
          app: artifact.app,
          version: artifact.version,
          status: 'failed',
          duration,
          error: `artifact installed, app not running: ${why}`,
        };
      }

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
    options?: {
      concurrency?: number;
      /**
       * The app definitions these artifacts belong to.
       *
       * Without them a node receives artifacts and never learns what to do
       * with them: its daemon says `No projects registered` and
       * `omnitron restart main` answers `Unknown app: main`. Optional so the
       * existing callers keep working, and every one of them should pass it.
       */
      apps?: readonly import('../config/types.js').IEcosystemAppEntry[];
      /**
       * What each app connects to, resolved by this master for this node.
       *
       * Per app rather than as an infrastructure block: a block is a stack
       * the node PROVISIONS, and writing one made the node build a second
       * complete set of containers beside the master's and sweep the
       * master's away. See `NodeConfigInput.appEnv`.
       */
      appEnv?: Readonly<Record<string, Record<string, string>>> | undefined;
    },
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
        // Install only when the definitions are coming: the app cannot be
        // started before the node knows it exists.
        const result = await this.deployToNode(task.target, task.artifact, project, {
          startAfterInstall: !options?.apps?.length,
        });
        results.push(result);
      })();

      executing.add(promise);
      promise.finally(() => executing.delete(promise));

      if (executing.size >= concurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);

    // Tell each node what it now has. After the transfers, because a config
    // naming an artifact that has not landed yet is a config the node will
    // fail on — and only for the apps that actually arrived, which is what
    // `results` knows and the artifact list does not.
    if (options?.apps?.length) {
      for (const target of targets) {
        // The SAME key `deployToNode` builds — `host:daemonPort`. Comparing
        // against the SSH port here matched nothing, so the registration and
        // the start phase would both have run over an empty list and reported
        // nothing wrong.
        const nodeKey = `${target.host}:${target.daemonPort ?? 9700}`;
        const landed = results
          .filter((r) => r.node === nodeKey && r.status === 'success')
          .map((r) => ({ app: r.app, version: r.version }));
        await this.registerNodeApps(target, project, options.apps, landed, options.appEnv);

        // Now that the node knows what these apps are, start them. Their
        // result is upgraded in place, so a caller reading `results` sees
        // running apps rather than installed files.
        for (const entry of landed) {
          const result = results.find((r) => r.app === entry.app && r.node === nodeKey);
          if (!result) continue;

          const started = await this.signalRemoteDaemon(target, entry.app);
          const health = started.ok ? await this.verifyHealth(target, entry.app) : { online: false, detail: started.detail };
          if (health.online) {
            this.emitProgress(result.node, entry.app, 'success', 100, 'Running');
            continue;
          }

          // Installed and not running is a failure, and it is the state this
          // fleet reported as success for as long as it has existed.
          result.status = 'failed';
          result.error = `artifact installed, app not running: ${started.ok ? health.detail : started.detail}`;
          this.emitProgress(result.node, entry.app, 'failed', 90, result.error);
          this.logger.error(
            { node: result.node, app: entry.app, version: entry.version, detail: result.error },
            'Artifact installed, but the app is not running on the node',
          );
        }
      }
    }

    return results;
  }

  /**
   * Give a node the config that tells it what to run.
   *
   * Written, then registered. Registering a path with no config in it leaves
   * the daemon with a project it cannot read, which reports as a broken
   * project rather than a missing file.
   *
   * Reported and not thrown: artifacts that transferred are on the node
   * either way, and failing the whole deployment over the registration would
   * discard a transfer that succeeded. The operator needs to know the apps
   * are not runnable, which is what the error says.
   */
  private async registerNodeApps(
    target: DeployTarget,
    project: string,
    apps: readonly import('../config/types.js').IEcosystemAppEntry[],
    landed: ReadonlyArray<{ app: string; version: string }>,
    appEnv?: Readonly<Record<string, Record<string, string>>> | undefined,
  ): Promise<void> {
    if (landed.length === 0) {
      this.logger.warn({ host: target.host, project }, 'No artifact reached this node — nothing to register');
      return;
    }

    const { renderNodeAppConfig } = await import('../project/node-app-config.js');
    const dir = `/opt/omnitron/projects/${assertRemotePathSegment('project name', project)}`;
    const body = renderNodeAppConfig({
      project,
      artifactRoot: '/opt/omnitron/artifacts',
      apps,
      artifacts: landed,
      appEnv,
    });

    try {
      await this.sshExec(target, `mkdir -p ${shellEscape(dir)}`);
      // Through a here-document: the config carries braces, quotes and
      // newlines, and a single-quoted argument would need every quote in it
      // escaped by hand — which is how a generated file acquires a syntax
      // error nobody can see in the source that generated it.
      const configPath = `${dir}/omnitron.config.mjs`;
      // `umask 077` around the write, not a `chmod` after it: the file exists
      // with its contents between the two, and what it contains is the
      // generated password of every service on this node. It was written 0644
      // for as long as it has existed — measured on the test node — which was
      // harmless only because it held no credentials to leak.
      await this.sshExec(
        target,
        `umask 077 && cat > ${shellEscape(configPath)} <<'OMNITRON_EOF'\n${body}\nOMNITRON_EOF`,
      );
      await this.sshExec(target, `chmod 600 ${shellEscape(configPath)}`);
      const added = await this.sshExec(target, `omnitron project add ${shellEscape(project)} ${shellEscape(dir)} 2>&1`);

      // Registering the project is not starting it. The node reads the
      // definitions and waits: measured, `omnitron status` answered
      // `appsTotal: 0` with all six apps listed in the file it had just been
      // given, and `omnitron restart main` still said `Unknown app: main`.
      //
      // `startStack` is how a project's apps are started, which is why the
      // generated config carries a stack for them to be in.
      const { NODE_STACK } = await import('../project/node-app-config.js');
      const out = await this.sshExec(
        target,
        `omnitron stack start ${shellEscape(project)} ${shellEscape(NODE_STACK)} 2>&1`,
        300_000,
      );
      void added;

      // The node's CLI prints its refusals and exits zero — `omnitron project
      // add` answered `No omnitron.config.ts found at …` and this logged
      // `The node now knows what to run` over it, twice, while the node knew
      // nothing. An exit code that does not carry the outcome means the
      // OUTPUT is the outcome.
      const refused = /\bno .*found\b|\bfailed\b|\berror\b|not found|cannot/i.test(`${added}\n${out}`);
      if (refused) {
        this.logger.error(
          { host: target.host, project, dir, detail: `${added}\n${out}`.trim().slice(0, 300) },
          'The node refused the apps it was given — its artifacts are installed and it will run none of them',
        );
        return;
      }

      this.logger.info(
        { host: target.host, project, dir, apps: landed.map((l) => l.app), detail: out.trim().slice(0, 200) },
        'The node now knows what to run',
      );
    } catch (err) {
      this.logger.error(
        { host: target.host, project, dir, error: (err as Error).message },
        'Could not tell the node what to run — its artifacts are installed and its daemon does not know the apps',
      );
    }
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

  /**
   * Ask the node's daemon to run the app whose artifact just landed.
   *
   * This was `omnitron restart <app> 2>/dev/null || true`, and the `|| true`
   * was hiding the whole of the remote deployment's last mile.
   *
   * Measured on the test node, running the command by hand:
   *
   *     omnitron restart main  →  Failed: Unknown app: main
   *
   * The node's daemon has no app definitions — its own log says `No projects
   * registered`, and `omnitron status --json` answers `appsTotal: 0` — because
   * nothing in this deployment ever tells it about the apps. Artifacts land
   * at `/opt/omnitron/artifacts/<project>/<app>/<version>/` complete with
   * `config`, `dist` and `package.json`, and a project is "a directory with
   * omnitron.config.ts", which an artifact is not.
   *
   * That gap is not closed here — it is a design question about how a node
   * learns what to run. What is closed here is its INVISIBILITY: the shell
   * discarded the only sentence that said so, and the caller reported
   * `Deployment successful`.
   */
/**
   * Ship a built frontend to a node and say where it landed.
   *
   * The gateway's config travels inside the provisioning RPC — six files, 65
   * KB. A frontend build is 32 MB, and an RPC argument is the wrong shape for
   * that: it is held whole in memory on both sides and blocks the call it
   * rides on. So it goes the way artifacts already go — tar over SSH, extract
   * on the far side — which is the mechanism this class exists for.
   *
   * Idempotent by content: the archive's hash names the directory, so a build
   * that has not changed is transferred once and every later provisioning pass
   * finds it already there. A build that HAS changed lands beside the old one
   * and the gateway's spec hash changes with the path, which is what makes the
   * container pick it up.
   */
  async uploadStaticBundle(
    target: DeployTarget,
    localDir: string,
    remoteRoot: string,
  ): Promise<{ remoteDir: string; bytes: number }> {
    const { createHash } = await import('node:crypto');
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');

    const stat = await fsp.stat(localDir).catch(() => null);
    if (!stat?.isDirectory()) throw new Error(`No such directory to serve: ${localDir}`);

    const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'omnitron-static-'));
    const archive = path.join(staging, 'static.tar.gz');
    try {
      // `-C` so the archive holds the directory's CONTENTS, not a path from
      // this machine: the node mounts what is inside, and a leading
      // `apps/portal/dist/` would put every file one level too deep.
      // `COPYFILE_DISABLE=1`: macOS `tar` writes an AppleDouble sidecar for
      // every file with an extended attribute, and this archive is unpacked
      // straight into the gateway's web root. Measured there:
      // `._index.html`, `._assets`, `._docs-static` — 163 bytes each, served
      // to anyone who asks for them.
      await this.execution.exec(
        `COPYFILE_DISABLE=1 tar -czf ${shellEscape(archive)} -C ${shellEscape(localDir)} .`,
      );
      const bytes = (await fsp.stat(archive)).size;
      const digest = createHash('sha256').update(await fsp.readFile(archive)).digest('hex').slice(0, 16);

      const remoteDir = `${remoteRoot}/${digest}`;
      const remoteFile = `${remoteDir}.tar.gz`;

      // Already there: the same build was sent before. Transferring it again
      // costs 32 MB over a link that may be an SSH tunnel, for no change.
      const exists = await this.sshExec(target, `test -d ${shellEscape(remoteDir)} && echo yes || echo no`).catch(() => 'no');
      if (exists.trim() === 'yes') return { remoteDir, bytes: 0 };

      await this.sshExec(target, `mkdir -p ${shellEscape(remoteDir)}`);
      await this.execution.uploadFile(sshTargetOf(target), archive, remoteFile);
      await this.sshExec(target, `tar -xzf ${shellEscape(remoteFile)} -C ${shellEscape(remoteDir)} && rm -f ${shellEscape(remoteFile)}`);

      this.logger.info({ host: target.host, remoteDir, bytes }, 'Static bundle delivered to the node');
      return { remoteDir, bytes };
    } finally {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async signalRemoteDaemon(target: DeployTarget, appName: string): Promise<{ ok: boolean; detail: string }> {
    try {
      // No `2>/dev/null`, no `|| true`: the failure IS the information.
      const out = await this.sshExec(target, `omnitron restart ${shellEscape(appName)} 2>&1`);
      const failed = /unknown app|failed|not found|no such/i.test(out);
      if (failed) {
        this.logger.error(
          { host: target.host, app: appName, detail: out.trim().slice(0, 300) },
          'The node refused to start this app — its artifact is installed and its daemon does not know the app',
        );
        return { ok: false, detail: out.trim().slice(0, 300) };
      }
      return { ok: true, detail: out.trim().slice(0, 200) };
    } catch (err) {
      const detail = (err as Error).message;
      this.logger.error({ host: target.host, app: appName, error: detail }, 'Could not reach the node to start this app');
      return { ok: false, detail };
    }
  }

  /**
   * Whether the app is actually running on the node.
   *
   * This returned `void` on every path — a match, a mismatch, a parse failure,
   * an unreachable node — under a comment reading "Health check is
   * best-effort". A verification that cannot fail is not a verification, and
   * it is worse than none: its presence in the sequence is what persuades a
   * reader that the deployment was checked.
   */
  private async verifyHealth(target: DeployTarget, appName: string): Promise<{ online: boolean; detail: string }> {
    let status: string;
    try {
      status = await this.sshExec(target, `omnitron status --json 2>&1`, 15_000);
    } catch (err) {
      return { online: false, detail: `could not read the node's status: ${(err as Error).message}` };
    }

    let parsed: { data?: { apps?: Array<{ name?: string; status?: string }>; appsTotal?: number } };
    try {
      parsed = JSON.parse(status);
    } catch {
      // A node that answers something other than JSON is a node whose CLI is
      // not the one this expects — worth saying, not worth guessing about.
      return { online: false, detail: `the node's status was not JSON: ${status.trim().slice(0, 120)}` };
    }

    const apps = parsed?.data?.apps ?? [];
    const app = apps.find((a) => a.name === appName);
    if (!app) {
      return {
        online: false,
        detail: `the node is running ${apps.length} app(s) and none of them is '${appName}'`,
      };
    }
    return app.status === 'online'
      ? { online: true, detail: 'online' }
      : { online: false, detail: `the node reports it as '${app.status ?? 'unknown'}'` };
  }

  // ===========================================================================
  // Private — Progress
  // ===========================================================================

  private emitProgress(node: string, app: string, status: DeployStatus, progress: number, message: string): void {
    const event: DeployProgress = { node, app, status, progress, message };
    this.lastProgress.set(`${node}\u0000${app}`, { ...event, at: new Date().toISOString() });
    for (const handler of this.progressHandlers) {
      try {
        handler(event);
      } catch {
        // Handler failure must not break deployment
      }
    }
  }

  /**
   * What each app on each node is doing, newest first.
   *
   * For a console that polls. Returned as a list rather than the map so a
   * caller cannot hold a reference that keeps changing underneath it while
   * it renders.
   */
  getProgress(): DeployProgressRecord[] {
    return [...this.lastProgress.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }
}
