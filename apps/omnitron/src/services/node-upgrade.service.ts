/**
 * Upgrading a node's omnitron from the console.
 *
 * `fleet upgrade` does this from a terminal: build a bundle from the working
 * tree, ship it, install it beside the running copy, switch and restart. The
 * console could not, because the two RPCs that do the last part —
 * `installBundleOnNode`, `activateBundleOnNode` — take an archive path on
 * the DAEMON's filesystem, and only the CLI knew how to produce one.
 *
 * So this is the middle: the daemon builds its own bundle, from the
 * workspace it is running out of, and then calls the same two methods the
 * CLI does. A node ends up with the same artifact whichever surface asked
 * for it.
 *
 * A build takes minutes, so an upgrade is started and polled rather than
 * awaited: `start` returns as soon as the work is under way and `progress`
 * says where it is. That is the same shape as a stack deployment, for the
 * same reason, and the console already knows how to render it.
 *
 * A daemon that is not running from a workspace — one installed from a
 * bundle, which is every node — refuses with the reason rather than failing
 * somewhere inside a build. It has nothing to build FROM.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ILogger } from '@omnitron-dev/titan/module/logger';

export type UpgradePhase =
  | 'building'
  | 'transferring'
  | 'activating'
  | 'done'
  | 'failed'
  | 'refused';

export interface NodeUpgradeProgress {
  readonly nodeId: string;
  readonly phase: UpgradePhase;
  /** 0-100, for a bar that means something rather than a spinner. */
  readonly percent: number;
  readonly message: string;
  /** The version being installed, once the build has named one. */
  readonly version: string | null;
  readonly at: string;
}

/** What this service needs from the node registry. */
export interface UpgradeNodeSource {
  getNode(id: string): { id: string; name: string; isLocal?: boolean } | null;
}

/** What it needs from the deployer — the same two calls the CLI makes. */
export interface UpgradeDeployer {
  installBundle(target: never, archivePath: string, version: string): Promise<boolean>;
  activateBundle(target: never, version: string, prefix?: string, keepVersions?: number): Promise<boolean>;
}

export class NodeUpgradeService {
  private readonly progressByNode = new Map<string, NodeUpgradeProgress>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly logger: ILogger,
    private readonly nodes: UpgradeNodeSource,
    /** Resolves a node id to the deploy target, credentials included. */
    private readonly toTarget: (nodeId: string) => Promise<never>,
    private readonly deployer: () => UpgradeDeployer,
    private readonly audit?: { record(entry: { action: string; resourceType: string; resourceId?: string; details?: Record<string, unknown> }): Promise<void> } | undefined,
  ) {}

  /** Everything this daemon has been asked to upgrade, newest state per node. */
  listProgress(): NodeUpgradeProgress[] {
    return [...this.progressByNode.values()].sort((a, b) => b.at.localeCompare(a.at));
  }

  progressFor(nodeId: string): NodeUpgradeProgress | null {
    return this.progressByNode.get(nodeId) ?? null;
  }

  /**
   * Begin an upgrade. Returns once it is under way, or with the reason it
   * cannot be.
   *
   * One at a time per node: two installs racing on one machine is an upgrade
   * whose outcome nobody can predict — the same reason `planUpgrade`
   * collapses two registry rows that name one box.
   */
  async start(nodeId: string): Promise<{ started: boolean; reason?: string }> {
    const node = this.nodes.getNode(nodeId);
    if (!node) return { started: false, reason: 'No such node' };
    if (node.isLocal) {
      return { started: false, reason: 'This is the local daemon — it is upgraded by rebuilding it' };
    }
    if (this.inFlight.has(nodeId)) {
      return { started: false, reason: 'An upgrade of this node is already running' };
    }

    const workspace = this.workspaceRoot();
    if (!workspace) {
      const reason =
        'This daemon does not run from an omnitron workspace, so it has no source to build a bundle from';
      this.emit(nodeId, 'refused', 0, reason, null);
      return { started: false, reason };
    }

    this.inFlight.add(nodeId);
    this.emit(nodeId, 'building', 5, 'Building a bundle from this working tree...', null);

    // Deliberately not awaited: a build is minutes, and an RPC that takes
    // minutes is an RPC that times out somewhere in between.
    void this.run(nodeId, node.name, workspace).finally(() => this.inFlight.delete(nodeId));
    return { started: true };
  }

  private async run(nodeId: string, nodeName: string, workspace: string): Promise<void> {
    let version: string | null = null;
    let bundle: import('./bundle-builder.js').OwnBundle | null = null;

    try {
      const { buildOwnBundle } = await import('./bundle-builder.js');
      bundle = await buildOwnBundle({
        workspaceRoot: workspace,
        // One directory per node, because two consoles may be upgrading two
        // nodes from this daemon at the same moment.
        label: `${process.pid}-${nodeId.slice(0, 8)}`,
        logger: this.logger,
      });
      version = bundle.version;
      this.emit(nodeId, 'transferring', 40, `Built ${version} — transferring`, version);

      const archive = await bundle.pack();
      const target = await this.toTarget(nodeId);

      const installed = await this.deployer().installBundle(target, archive, version);
      if (!installed) {
        this.emit(nodeId, 'failed', 40, 'The install failed; this node is unchanged', version);
        return;
      }

      this.emit(nodeId, 'activating', 80, 'Switching the node into the new version', version);
      const activated = await this.deployer().activateBundle(target, version, '/opt/omnitron', 3);
      if (!activated) {
        this.emit(
          nodeId,
          'failed',
          80,
          'The new version did not come up; the previous one is still installed on this node',
          version,
        );
        return;
      }

      this.emit(nodeId, 'done', 100, `Running ${version}`, version);
      this.logger.info({ node: nodeName, nodeId, version }, 'Node upgraded from the console');
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.emit(nodeId, 'failed', 0, message, version);
      this.logger.error({ node: nodeName, nodeId, error: message }, 'Node upgrade failed');
    } finally {
      await bundle?.cleanup();
    }
  }

  /**
   * The workspace this daemon runs out of, or null when it does not.
   *
   * From this module's own location rather than `process.cwd()`: a daemon
   * started by launchd or systemd has a working directory that says nothing
   * about where its code is.
   */
  private workspaceRoot(): string | null {
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      // Synchronous on purpose: this decides whether to start at all.
      let dir = here;
      for (;;) {
        if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
      }
    } catch {
      return null;
    }
  }

  private emit(
    nodeId: string,
    phase: UpgradePhase,
    percent: number,
    message: string,
    version: string | null,
  ): void {
    const entry: NodeUpgradeProgress = {
      nodeId,
      phase,
      percent,
      message,
      version,
      at: new Date().toISOString(),
    };
    this.progressByNode.set(nodeId, entry);

    if (phase === 'done' || phase === 'failed') {
      void this.audit?.record({
        action: phase === 'done' ? 'node.upgrade' : 'node.upgrade.failed',
        resourceType: 'node',
        resourceId: nodeId,
        details: { version: version ?? 'unknown', message },
      });
    }
  }
}
