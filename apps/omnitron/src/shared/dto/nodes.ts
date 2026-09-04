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
  sshConnected: boolean;
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
