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
  omnitronConnected: boolean;
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
