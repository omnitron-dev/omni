/**
 * Node DTOs — wire shapes shared with the Omnitron Console.
 *
 * Declared away from the service implementation for the reason set out in
 * `./auth.ts`.
 */

export interface INode {
  id: string;
  name: string;
  host: string;
  sshPort: number;
  sshUser: string;
  sshAuthMethod: 'password' | 'key';
  sshPrivateKey?: string;
  /** Whether an encrypted passphrase is stored in secrets.enc */
  hasPassphrase?: boolean;
  /** Whether an SSH password is stored in secrets.enc */
  hasPassword?: boolean;
  /** Runtime to install/use on remote nodes */
  runtime: 'node' | 'bun';
  /** Omnitron daemon port on this node */
  daemonPort: number;
  /** Tags for filtering/grouping */
  tags: string[];
  /** Whether this is the local machine (cannot be deleted) */
  isLocal: boolean;
  /** When the node was added */
  createdAt: string;
  /** Last modification */
  updatedAt: string;
  /** Per-node offline timeout in ms (null = use global default) */
  offlineTimeout?: number | null;
}

export interface INodeStatus {
  nodeId: string;
  pingReachable: boolean;
  pingLatencyMs: number | null;
  pingError?: string;
  /**
   * Whether an SSH connection was established — `null` when none was tried.
   *
   * The distinction is load-bearing. Two producers fill this in: the
   * health-monitor worker, which opens an SSH session on every round, and the
   * daemon's own fallback check, which does not — it pings and probes the
   * Netron port, because a node running omnitron is reached over Netron and
   * SSH is for provisioning it. The fallback used to write `false` here, and
   * `false` means "SSH was refused" to every reader: the console showed
   * "Waiting for SSH connection" for a node whose SSH works, and never showed
   * `omnitronError`, which held the actual reason.
   */
  sshConnected: boolean | null;
  sshLatencyMs: number | null;
  sshError?: string;
  /**
   * Whether the node's daemon answered — `null` when no path reached it.
   *
   * The same three states as `sshConnected`, for the same reason. The
   * daemon's own check asks over the mesh and then dials the daemon port;
   * when neither gets through, that is not evidence the daemon is down — the
   * port of a hardened node is closed to the master by design — and `false`
   * printed «offline» about a node serving six apps. `omnitronError` says
   * which paths were tried and why each failed.
   */
  omnitronConnected: boolean | null;
  omnitronVersion?: string;
  omnitronPid?: number;
  omnitronUptime?: number;
  omnitronRole?: 'master' | 'slave';
  omnitronError?: string;
  /** OS info from remote node */
  os?: { platform: string; arch: string; hostname: string; release: string };
  checkedAt: string;
}

export interface INodeWithStatus extends INode {
  status: INodeStatus | null;
}

export interface AddNodeInput {
  name: string;
  host: string;
  sshPort?: number;
  sshUser?: string;
  sshAuthMethod?: 'password' | 'key';
  sshPrivateKey?: string;
  /** Passphrase for encrypted SSH key (will be encrypted in secrets.enc) */
  sshPassphrase?: string;
  /** SSH password auth (will be encrypted in secrets.enc) */
  sshPassword?: string;
  runtime?: 'node' | 'bun';
  daemonPort?: number;
  tags?: string[];
  offlineTimeout?: number | null;
}

export interface UpdateNodeInput {
  name?: string;
  host?: string;
  sshPort?: number;
  sshUser?: string;
  sshAuthMethod?: 'password' | 'key';
  sshPrivateKey?: string;
  /** Passphrase for encrypted SSH key (will be encrypted in secrets.enc) */
  sshPassphrase?: string;
  /** SSH password auth (will be encrypted in secrets.enc) */
  sshPassword?: string;
  runtime?: 'node' | 'bun';
  daemonPort?: number;
  tags?: string[];
  offlineTimeout?: number | null;
}

export interface SshKeyInfo {
  name: string;
  path: string;
  type: string;
}

/**
 * How the fleet is checked — the operator-tunable half.
 *
 * Declared here rather than beside the checker for the reason in the header:
 * the console reads and writes this shape over RPC, and a console type that
 * had to import the checker would drag `node:child_process` with it.
 */
export interface NodeCheckConfig {
  /** Whether ICMP ping is attempted at all. */
  pingEnabled: boolean;
  /** Ping timeout, ms. */
  pingTimeout: number;
  /** SSH connect+command timeout, ms. */
  sshTimeout: number;
  /** Remote omnitron probe timeout, ms. */
  omnitronCheckTimeout: number;
  /** Max nodes checked at once. */
  concurrency: number;
}

/**
 * How much history there is, and how the console should slice it.
 *
 * `uptimeIntervalMs` and `retentionDays` are daemon configuration the console
 * needs in order to ask a question that can be answered: it hard-coded a
 * 24-hour bucket and asked for 200 of them against a daemon that keeps 90
 * days, so three of every four segments were "no data" by construction and
 * every poll asked the database for a window that cannot exist.
 */
export interface FleetHistoryConfig {
  /** Width of one uptime-bar segment, ms. */
  uptimeIntervalMs: number;
  /** How long check history is kept, days. */
  retentionDays: number;
}

/**
 * A node's membership of the mesh, as the console shows it.
 *
 * Distinct from `INodeStatus`, which answers "can this master reach it" —
 * SSH, ping, a daemon that answers. A node can pass all of that and
 * replicate nothing, which is what every registered node did until the
 * master started dialling the ones no stack had been deployed onto.
 */
export interface IMeshNodeStatus {
  nodeId: string;
  /** False means the master is not connected to it at all. */
  inMesh: boolean;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  /** `ssh-tunnel` means the node's daemon port is closed to this master. */
  via: 'direct' | 'ssh-tunnel' | null;
  /** False on a live connection means pings work and no data can be pulled. */
  authenticated: boolean;
  lastHeartbeat: number | null;
  lastError: string | null;
}

/**
 * What a node's own titan-health reports about it.
 *
 * `reachable` is about the QUESTION, not the answer: false means the node was
 * not asked — it is outside the mesh, or the call failed — and carries the
 * reason. A node that could not be asked has reported nothing, and nothing is
 * not a verdict. Rendering it as `unhealthy` is the same mistake as reading an
 * unmeasured SSH layer as a refusal, which this console has made once already.
 */
export interface INodeIndicators {
  nodeId: string;
  /** Whether the node answered at all. */
  reachable: boolean;
  /** Why it did not, when it did not. */
  error: string | null;
  /** The node's overall verdict — `null` when it was not asked. */
  status: string | null;
  /** Indicator name → its result, as titan-health reports it. */
  indicators: Record<string, unknown>;
}

/**
 * One question put to a node's own daemon, over the mesh.
 *
 * The fleet commands dial `host:9700` and ask `OmnitronDaemon` directly. A
 * node whose daemon port is not open to this master — which is the normal
 * state of a hardened server, and the reason the mesh tunnels over SSH —
 * answers nothing, so `fleet status` listed a machine running six apps as
 * `offline  0 apps`, and `fleet health` and `fleet metrics` had nothing to
 * print either.
 *
 * `reachable: false` carries the reason and never a verdict: a node that
 * could not be asked has not reported anything, and rendering silence as
 * `offline` sends an operator to look at the wrong machine.
 */
export interface INodeDaemonAnswer<T> {
  nodeId: string;
  /** Whether the node's daemon answered at all. */
  reachable: boolean;
  /** Why it did not, when it did not. */
  error: string | null;
  /** What it said — `null` when it was not asked or did not answer. */
  answer: T | null;
}

/**
 * Whether a node's data is reaching this master.
 *
 * Reachability and membership are different questions, and so are membership
 * and MOVEMENT. A node can answer every ping, sit in the mesh authenticated,
 * and still have delivered nothing — `pendingItems` climbing while
 * `lastSyncAt` stands still is the whole diagnosis.
 *
 * `reachable: false` means the node was not asked, and carries why. It is not
 * "not replicating".
 */
export interface INodeSyncStatus {
  nodeId: string;
  reachable: boolean;
  error: string | null;
  sync: import('./project.js').ISyncStatus | null;
}

/**
 * A node's telemetry relay, as it reports itself.
 *
 * The companion to `INodeSyncStatus`: that one is the log/metric replication,
 * this one the telemetry relay. It carries the only counter in the fleet that
 * reports LOSS — `relay.buffer.totalDropped`, entries the buffer threw away
 * because it was full. A gap in a chart is otherwise discovered from the chart.
 *
 * `reachable: false` means the node was not asked, and carries why.
 */
export interface INodeRelayStats {
  nodeId: string;
  reachable: boolean;
  error: string | null;
  /** As `TelemetryRelayService.stats()` returns it; shape owned by that package. */
  relay: Record<string, unknown> | null;
}

/**
 * Which node a node believes is the leader.
 *
 * Only meaningful ACROSS nodes: one node's answer is unremarkable, and two
 * nodes naming different leaders — or sitting in different terms — is a split
 * brain, the state in which every node is individually healthy and the fleet
 * is not.
 */
export interface INodeClusterState {
  nodeId: string;
  reachable: boolean;
  error: string | null;
  /** As `LeaderElection.getClusterState()` returns it. */
  cluster: Record<string, unknown> | null;
}

// =============================================================================
// Fleet rollout — upgrading many nodes from the console
// =============================================================================

/**
 * What a rollout will do to one node, decided BEFORE anything is shipped.
 *
 * The console shows these rows behind a «Plan» button so an operator sees the
 * outcome before the outcome happens: how many will move, how many are
 * already there, who cannot be reached and why. `planUpgrade` in
 * `services/node-upgrade.ts` is the pure function that produces the decision;
 * this is that decision projected onto the wire, with the two fields a table
 * needs added — the node's label and the machine behind it.
 *
 * `host` is `host:sshPort`, the MACHINE, and it is here because two registry
 * entries can name one box. Measured: `daos-test` and `acme-deploy-test`,
 * both `37.27.130.185:22`, listed as two targets — one host would have
 * received the bundle twice, the second install running while the first was
 * still switching `current` underneath it. The plan collapses them and says
 * so in `because`; showing the address is how an operator can see that the
 * collapse was right.
 */
export interface INodeUpgradePlanRow {
  nodeId: string;
  /** What the node is called in the console — `UpgradeCandidate.name`. */
  label: string;
  /** `host:sshPort`. Null when the registry entry has no usable address. */
  host: string | null;
  /** What it runs now; null means it could not be asked. */
  currentVersion: string | null;
  /**
   * What the rollout would install. NULL in a plan asked for without a
   * build: nothing has been compiled, so there is no version to compare
   * against, and a made-up string here would be compared anyway.
   */
  targetVersion: string | null;
  action: 'upgrade' | 'skip' | 'refuse';
  /**
   * Why, in the words the operator should read — «already on 0.2.0+…»,
   * «unreachable: …», «the same machine as 'daos-test'».
   *
   * Empty for an `upgrade` row: there is no reason to give for doing the
   * thing that was asked for.
   */
  because: string;
}

/** The whole plan, as `planUpgrade` decided it. */
export interface INodeUpgradePlan {
  /**
   * The version this rollout would install everywhere, or null when the plan
   * was asked for without building one.
   *
   * A plan without it still says which nodes are local, which refused SSH
   * and which would be attempted — everything except «already on it», which
   * is the one decision that needs something to compare against.
   */
  targetVersion: string | null;
  /**
   * False when no bundle was built, so the console can say that rather than
   * letting an operator read «12 to upgrade» as a comparison that happened.
   */
  compared: boolean;
  rows: INodeUpgradePlanRow[];
  /**
   * Set when the run must not start at all — a daemon with nothing to build
   * from, for instance. Distinct from every row refusing: this is about the
   * rollout, not about the nodes.
   */
  refusal: string | null;
}

/** What a rollout accepted, and what it would not take. */
export interface INodeRolloutStart {
  /** Node ids the daemon has queued. Order is the order they will run in. */
  accepted: string[];
  /**
   * Nodes the daemon declined to queue, each with its reason — already
   * running, unknown to the registry, held by another deployment.
   *
   * Refused rather than silently dropped: a rollout that quietly shrinks is
   * how an operator comes to believe a node was upgraded when it was not.
   */
  refused: Array<{ nodeId: string; because: string }>;
}
