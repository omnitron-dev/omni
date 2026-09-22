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

import { planUpgrade } from './node-upgrade.js';

import type { ILogger } from '@omnitron-dev/titan/module/logger';

export type UpgradePhase =
  /**
   * Accepted by the rollout and waiting for a slot.
   *
   * Without this, a queued node is indistinguishable from a node nobody
   * asked about: both have no progress record, and the console can only
   * show «nothing is happening». On a fleet rolled out at concurrency 2,
   * waiting is the state MOST nodes are in for MOST of the run, so it is
   * the one that has to be nameable.
   */
  | 'queued'
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
  /**
   * Place in the queue, 1-based, while `phase` is `queued`.
   *
   * Absent once the node starts: a number that keeps its old value after the
   * wait is over says something false about the present.
   */
  readonly position?: number;
}

/** What this service needs from the node registry. */
export interface UpgradeNodeSource {
  getNode(id: string): { id: string; name: string; isLocal?: boolean } | null;
  /**
   * Every node, in the shape the planner decides on.
   *
   * The planner needs four things `getNode` does not carry: the version each
   * node runs, whether SSH worked last time, and the MACHINE behind the
   * registry row. Asking for them here — rather than reaching into the
   * registry from the planner — keeps this service testable with a literal.
   *
   * Optional so the one existing construction site and the tests keep
   * working; `plan()` refuses with a reason when it is absent, because a
   * planner that answers an empty plan would read as «this fleet is up to
   * date».
   */
  listCandidates?(): readonly import('./node-upgrade.js').UpgradeCandidate[];
}

/** What it needs from the deployer — the same two calls the CLI makes. */
export interface UpgradeDeployer {
  installBundle(target: never, archivePath: string, version: string): Promise<boolean>;
  activateBundle(target: never, version: string, prefix?: string, keepVersions?: number): Promise<boolean>;
  /**
   * Run `work` holding the node's deploy lease — the same one a stack
   * deployment takes. Optional so a caller without leases keeps working; the
   * daemon's `RemoteDeployer` has it, and the console's upgrades went around
   * it until 2026-09-22: an upgrade could interleave with a deployment on
   * the same machine, one restarting the daemon the other was talking to.
   */
  underLease?<T>(target: never, purpose: string, work: () => Promise<T>): Promise<T>;
}

/**
 * The target version of a plan that did not build one.
 *
 * A sentinel rather than `''`, because `decideFor` compares it against each
 * node's current version and an empty string would silently match a node
 * whose version is unknown — turning «we did not compare» into «already on
 * it», which is the exact reading this plan exists to avoid.
 */
const UNKNOWN_TARGET = '\u0000unbuilt';

/** A bundle built for a rollout: its version, its archive, and how to remove both. */
export interface BuiltBundle {
  readonly version: string;
  readonly archive: string;
  cleanup(): Promise<void>;
}

export class NodeUpgradeService {
  private readonly progressByNode = new Map<string, NodeUpgradeProgress>();
  private readonly inFlight = new Set<string>();
  /** Nodes accepted by a rollout and still waiting for a slot, in order. */
  private readonly queue: string[] = [];
  /** Nodes whose install or activate is running now — not interruptible. */
  private readonly running = new Set<string>();

  constructor(
    private readonly logger: ILogger,
    private readonly nodes: UpgradeNodeSource,
    /** Resolves a node id to the deploy target, credentials included. */
    private readonly toTarget: (nodeId: string) => Promise<never>,
    private readonly deployer: () => UpgradeDeployer,
    private readonly audit?: { record(entry: { action: string; resourceType: string; resourceId?: string; details?: Record<string, unknown> }): Promise<void> } | undefined,
    /**
     * How a bundle is built. The default runs `bundle-build-worker.ts` in a
     * child process; a court passes its own so the queue can be judged
     * without compiling omnitron.
     */
    private readonly buildBundle?: (workspace: string, label: string) => Promise<BuiltBundle>,
  ) {}

  /** Everything this daemon has been asked to upgrade, newest state per node. */
  listProgress(): NodeUpgradeProgress[] {
    return [...this.progressByNode.values()].sort((a, b) => b.at.localeCompare(a.at));
  }

  progressFor(nodeId: string): NodeUpgradeProgress | null {
    return this.progressByNode.get(nodeId) ?? null;
  }

  /**
   * What a rollout would do to each node, without doing any of it.
   *
   * The version comes from a BUILD: a plan that cannot name the target
   * cannot say «already on it», and «already on it» is half the value —
   * without it an operator sees twelve rows saying `upgrade` where two need
   * upgrading. So this is expensive on purpose, and the console is told to
   * expect that rather than given a cheap answer that means less.
   *
   * The decision itself is `planUpgrade` in `node-upgrade.ts`, unchanged and
   * still pure: this method's whole job is to gather what that function
   * needs and to throw the bundle away afterwards.
   */
  async plan(
    only?: readonly string[],
    options: { readonly build?: boolean } = {},
  ): Promise<import('./node-upgrade.js').UpgradePlan & { readonly compared: boolean }> {
    // Said as a refusal, not as an empty plan. A planner wired without a
    // candidate source that answered `rows: []` would be read as «nothing
    // to upgrade», which is the one thing it cannot know.
    if (!this.nodes.listCandidates) {
      return {
        targetVersion: '',
        steps: [],
        toUpgrade: [],
        refusal: 'This daemon cannot list its fleet, so it cannot plan a rollout',
        compared: false,
      };
    }

    const workspace = this.workspaceRoot();
    if (!workspace) {
      return {
        targetVersion: '',
        steps: [],
        toUpgrade: [],
        refusal:
          'This daemon does not run from an omnitron workspace, so it has no source to build a bundle from',
        compared: false,
      };
    }

    const candidates = this.nodes.listCandidates();

    // WITHOUT A BUILD by default, and this is the important default.
    //
    // Naming the target version means compiling the workspace, and
    // `bundle-builder` does that with 42 synchronous fs calls including a
    // recursive `cpSync` of whole packages. On the daemon's own thread that
    // is not slow, it is a STOP: measured from the console, the master
    // answered nothing at all for ~150 s — health checks, node polls and
    // every other RPC stood still with it — and the request died at nginx's
    // 120 s `proxy_read_timeout` long before that, so no client deadline can
    // reach it either.
    //
    // The cheap plan still answers most of the question: which nodes are
    // local, which refused SSH, which would be attempted. What it cannot say
    // is «already on it», and it says THAT rather than pretending the
    // comparison happened.
    if (!options.build) {
      const plan = planUpgrade(candidates, UNKNOWN_TARGET, only ? { only } : {});
      return { ...plan, targetVersion: UNKNOWN_TARGET, compared: false };
    }

    // Built in a child process, like a rollout's bundle: the in-process
    // build this used to run is what stopped the daemon for ~150 s.
    const bundle = await (this.buildBundle ?? ((w, l) => this.buildInChild(w, l)))(workspace, `plan-${Date.now()}`);

    try {
      return { ...planUpgrade(candidates, bundle.version, only ? { only } : {}), compared: true };
    } finally {
      // A plan ships nothing, so the bundle it built has no further use.
      // Left behind, one per press of the Plan button, it is tens of
      // megabytes of staging directory each time.
      await bundle.cleanup().catch(() => undefined);
    }
  }

  /**
   * Begin an upgrade of one node — a rollout of one.
   *
   * Kept for the per-node button and the RPC that has always been there; it
   * goes through the same queue as a fleet rollout, so there is one path for
   * «build, lease, install, activate», not two that drift.
   */
  async start(nodeId: string): Promise<{ started: boolean; reason?: string }> {
    const outcome = this.rollout([nodeId], 1);
    if (outcome.accepted.length === 1) return { started: true };
    return { started: false, reason: outcome.refused[0]?.because ?? 'Not accepted' };
  }

  /**
   * Queue a rollout and return at once: what was taken, what was not and why.
   *
   * ONE bundle for the whole rollout, built in a child process
   * (`bundle-build-worker.ts`) so the daemon keeps answering while it
   * compiles; every accepted node then receives that same version. Building
   * per node, as the first version of this did, made «upgrade the fleet»
   * mean N builds of possibly different trees. Two rollouts at once each
   * install their own bundle on their own nodes — they share the queue's
   * numbering, not its nodes.
   *
   * `concurrency` nodes at a time, default 1: an upgrade restarts the daemon
   * it lands on, and a fleet that restarts together has no witness left.
   * The rest wait in `queued` with a position that is updated as the queue
   * moves.
   *
   * The decision of what to touch is `planUpgrade`, the same pure function
   * the plan shows — so the rollout refuses exactly what the plan said it
   * would, in the same words: the local daemon, a node SSH did not reach,
   * the second registry name for one machine.
   */
  rollout(
    nodeIds: readonly string[],
    concurrency = 1,
  ): { accepted: string[]; refused: Array<{ nodeId: string; because: string }> } {
    const refused: Array<{ nodeId: string; because: string }> = [];
    const accepted: string[] = [];

    const workspace = this.workspaceRoot();
    if (!workspace) {
      const because = 'This daemon does not run from an omnitron workspace, so it has no source to build a bundle from';
      for (const id of nodeIds) {
        this.emit(id, 'refused', 0, because, null);
        refused.push({ nodeId: id, because });
      }
      return { accepted, refused };
    }

    // The same decision the plan shows, without a build: which to touch.
    const candidates = this.nodes.listCandidates?.() ?? [];
    const plan = planUpgrade(candidates, UNKNOWN_TARGET, { only: nodeIds });
    if (plan.refusal) {
      for (const id of nodeIds) refused.push({ nodeId: id, because: plan.refusal });
      return { accepted, refused };
    }
    const decided = new Map(plan.steps.map((st) => [st.node.nodeId, st]));

    for (const id of nodeIds) {
      const node = this.nodes.getNode(id);
      if (!node) {
        refused.push({ nodeId: id, because: 'No such node' });
        continue;
      }
      if (this.inFlight.has(id)) {
        refused.push({ nodeId: id, because: 'An upgrade of this node is already queued or running' });
        continue;
      }
      // Planned against the unbuilt target, every node the plan would touch
      // reads `upgrade` — nothing has been compared, because the bundle is
      // built below. What the plan skips or refuses stays refused, in its
      // own words.
      const decision = decided.get(id)?.decision;
      if (decision?.action !== 'upgrade') {
        refused.push({
          nodeId: id,
          because: decision?.because ?? (node.isLocal ? 'This is the local daemon — it is upgraded by rebuilding it' : 'The plan did not select this node'),
        });
        continue;
      }
      accepted.push(id);
    }

    if (accepted.length === 0) return { accepted, refused };

    for (const id of accepted) {
      this.inFlight.add(id);
      this.queue.push(id);
    }
    this.renumberQueue();

    const width = Math.max(1, Math.min(8, Math.floor(concurrency) || 1));
    void this.runRollout(accepted, width, workspace).catch((err: Error) => {
      // Every node still waiting is told why it will not run — a rollout
      // that failed to build leaves no node silently «queued» for ever.
      for (const id of accepted) {
        if (!this.inFlight.has(id)) continue;
        this.dequeue(id);
        this.emit(id, 'failed', 0, `The rollout could not build its bundle: ${err.message.slice(0, 240)}`, null);
        this.inFlight.delete(id);
      }
      this.logger.error({ error: err.message }, 'Fleet rollout failed before any node was touched');
    });
    return { accepted, refused };
  }

  /**
   * Take a node out of a rollout — only if it has not started.
   *
   * A node already installing is not interrupted: stopping between unpacking
   * and activating leaves it worse than either end, and the answer says so.
   */
  cancel(nodeId: string): { stopped: boolean; because: string } {
    if (this.running.has(nodeId)) {
      return {
        stopped: false,
        because: 'This node is installing now — an upgrade is not interrupted between unpacking and activating',
      };
    }
    if (!this.queue.includes(nodeId)) {
      return { stopped: false, because: 'This node is not waiting in a rollout' };
    }
    this.dequeue(nodeId);
    this.inFlight.delete(nodeId);
    this.emit(nodeId, 'refused', 0, 'Dropped from the rollout before it started', null);
    this.renumberQueue();
    return { stopped: true, because: 'Dropped from the rollout before it started' };
  }

  private async runRollout(nodeIds: readonly string[], width: number, workspace: string): Promise<void> {
    const label = `${process.pid}-rollout-${Date.now()}`;
    for (const id of nodeIds) {
      if (this.queue.includes(id)) this.emitQueued(id, 'Building one bundle for the whole rollout…');
    }
    const bundle = await (this.buildBundle ?? ((w, l) => this.buildInChild(w, l)))(workspace, label);
    this.logger.info({ version: bundle.version, nodes: nodeIds.length, concurrency: width }, 'Fleet rollout: bundle built');

    // This rollout's own list. The queue is shared — it is what positions
    // are counted in — and a worker that took the queue's head would take a
    // node another rollout accepted, installing THIS bundle on it while the
    // other rollout's bundle, built for it, went unused.
    const mine = [...nodeIds];
    try {
      const workers = Array.from({ length: width }, async () => {
        for (;;) {
          const next = this.takeNext(mine);
          if (!next) return;
          await this.upgradeOne(next, bundle.version, bundle.archive);
        }
      });
      await Promise.all(workers);
    } finally {
      await bundle.cleanup();
    }
  }

  /** The next node of one rollout still waiting; one dropped by `cancel` has left the queue and is skipped. */
  private takeNext(mine: string[]): string | undefined {
    for (let id = mine.shift(); id !== undefined; id = mine.shift()) {
      if (!this.queue.includes(id)) continue;
      this.dequeue(id);
      this.renumberQueue();
      return id;
    }
    return undefined;
  }

  private async upgradeOne(nodeId: string, version: string, archive: string): Promise<void> {
    const node = this.nodes.getNode(nodeId);
    const nodeName = node?.name ?? nodeId;
    this.running.add(nodeId);
    try {
      const target = await this.toTarget(nodeId);
      const deployer = this.deployer();
      const work = async (): Promise<void> => {
        this.emit(nodeId, 'transferring', 40, `Installing ${version}`, version);
        const installed = await deployer.installBundle(target, archive, version);
        if (!installed) {
          this.emit(nodeId, 'failed', 40, 'The install failed; this node is unchanged', version);
          return;
        }
        this.emit(nodeId, 'activating', 80, 'Switching the node into the new version', version);
        const activated = await deployer.activateBundle(target, version, '/opt/omnitron', 3);
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
        this.logger.info({ node: nodeName, nodeId, version }, 'Node upgraded');
      };
      if (deployer.underLease) await deployer.underLease(target, `upgrade to ${version}`, work);
      else await work();
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.emit(nodeId, 'failed', 0, message, version);
      this.logger.error({ node: nodeName, nodeId, error: message }, 'Node upgrade failed');
    } finally {
      this.running.delete(nodeId);
      this.inFlight.delete(nodeId);
    }
  }

  /**
   * Build the bundle in a child process and wait for its one line of JSON.
   *
   * The child is this module's sibling, run with the daemon's own node and
   * loader flags, so it builds exactly what an in-process build would have.
   * Fifteen minutes is past any build measured; a build that takes longer is
   * a build that hung.
   */
  private async buildInChild(workspace: string, label: string): Promise<BuiltBundle> {
    const { execFile } = await import('node:child_process');
    const { ownBundleStaging } = await import('./bundle-builder.js');
    const worker = fileURLToPath(new URL('./bundle-build-worker.js', import.meta.url));
    const staging = ownBundleStaging(label);
    const cleanup = async () => {
      await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      await fs.promises.rm(`${staging}.tar.gz`, { force: true }).catch(() => undefined);
    };
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        [...process.execArgv, worker, workspace, label],
        { maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60_000 },
        (err, out, errOut) => {
          if (err) {
            const tail = String(errOut).trim().split('\n').slice(-4).join(' | ');
            reject(new Error(`the bundle build failed: ${tail || err.message}`));
          } else resolve(String(out));
        },
      );
    }).catch(async (err: Error) => {
      await cleanup();
      throw err;
    });
    const line = stdout.trim().split('\n').pop() ?? '';
    let parsed: { version?: string; archive?: string };
    try {
      parsed = JSON.parse(line) as { version?: string; archive?: string };
    } catch {
      await cleanup();
      throw new Error('the bundle build printed no result');
    }
    if (!parsed.version || !parsed.archive) {
      await cleanup();
      throw new Error('the bundle build named no version or archive');
    }
    return { version: parsed.version, archive: parsed.archive, cleanup };
  }

  private dequeue(nodeId: string): void {
    const i = this.queue.indexOf(nodeId);
    if (i >= 0) this.queue.splice(i, 1);
  }

  /** Every waiting node told its current place — a position that went stale would say something false. */
  private renumberQueue(): void {
    this.queue.forEach((id) => this.emitQueued(id));
  }

  private emitQueued(nodeId: string, message?: string): void {
    const position = this.queue.indexOf(nodeId) + 1;
    const entry: NodeUpgradeProgress = {
      nodeId,
      phase: 'queued',
      percent: 0,
      message: message ?? (position === 1 ? 'Next in the rollout' : `Waiting — ${position - 1} ahead`),
      version: null,
      at: new Date().toISOString(),
      ...(position > 0 ? { position } : {}),
    };
    this.progressByNode.set(nodeId, entry);
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
