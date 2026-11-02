/**
 * Registered peers receive short-lived daemon credentials over a loopback
 * listener forwarded to the node by Xec. Direct TCP is for public liveness.
 */
import net from 'node:net';
import { createHash } from 'node:crypto';
import { decodeJwt } from 'jose';
import { isLoopbackHost } from '../daemon/network-publication.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { ExecutionService, SSHTarget } from '../execution/execution.service.js';

/** One way in to one node, and how to give it back. */
export interface MeshLink {
  /** The address to hand netron. */
  url: string;
  /** Presented with `runTask('authenticate')`, when the node needs one. */
  token?: string | undefined;
  /** Local renewal deadline; the node independently verifies the token. */
  expiresAt?: number | undefined;
  /** Renew identity on the same peer without replacing its transport. */
  refreshCredential?: (() => Promise<{ token: string; expiresAt: number }>) | undefined;
  /** How the master got there, for the operator reading a node card. */
  via: 'direct' | 'ssh-tunnel';
  /**
   * Called when the node refuses this credential.
   *
   * A daemon's signing secret is read once and kept, because it does not
   * change — until the node is reinstalled, which writes a new one. The
   * master would then present the old secret on every reconnect, for as
   * long as it runs, and the node would refuse every time. Nothing in the
   * retry loop can notice that: a rejected credential and an unreachable
   * node fail at the same place.
   *
   * Given the failure, the cache can be dropped and the next attempt reads
   * the node's current secret.
   */
  onRejected?: ((reason?: string) => void) | undefined;
  /** Releases whatever was opened to make `url` work. */
  close?: (() => Promise<void>) | undefined;
}

export interface MeshTarget {
  host: string;
  /** The daemon's TCP port on the node. */
  port: number;
  nodeId?: string;
}

export function meshRegistration<T extends { id: string; host: string; daemonPort: number; isLocal: boolean }>(
  nodes: readonly T[], target: MeshTarget,
): T | null {
  const matches = nodes.filter(node => !node.isLocal && node.host === target.host && node.daemonPort === target.port);
  if (matches.length > 1) throw new Error('Ambiguous mesh address: multiple registered nodes share this daemon endpoint');
  if (target.nodeId !== undefined && matches[0]?.id !== target.nodeId) throw new Error('Registered mesh identity no longer matches this endpoint');
  return matches[0] ?? null;
}

export type MeshDialer = (target: MeshTarget) => Promise<MeshLink>;

/** The transport that needs nothing arranged. */
export const directLink = async (target: MeshTarget): Promise<MeshLink> => ({
  url: tcpEndpoint(target.host, target.port),
  via: 'direct',
});

function tcpEndpoint(host: string, port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Invalid mesh TCP port');
  return `tcp://${net.isIPv6(host) ? `[${host}]` : host}:${port}`;
}

/** Check the actual destination before handing a bearer token to Netron. */
export function assertMeshCredentialEndpoint(endpoint: string): void {
  const url = new URL(endpoint);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'tcp:' || url.username || url.password || !url.port || url.pathname || url.search || url.hash ||
      !net.isIP(host) || !isLoopbackHost(host) || tcpEndpoint(host, Number(url.port)) !== endpoint) {
    throw new Error('Mesh credentials require a numeric loopback endpoint. Use an Xec SSH tunnel for a remote daemon.');
  }
}

/**
 * Can a TCP connection be made, within a budget?
 *
 * Its own probe rather than "try netron and see": a netron connect that
 * fails has already built a Netron, registered a transport and started a
 * handshake, and the failure surfaces as a protocol timeout that reads like
 * a broken daemon. A refused or timed-out socket is the plain fact, and it
 * is what the unauthenticated liveness probe reports.
 */
export function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/**
 * The command that reads a daemon's own signing secret off a node.
 *
 * Node's own JSON parse rather than a shell tool, because `jq` is not
 * something a freshly provisioned machine has, and the runtime omnitron
 * installed certainly is. Written to stdout with no newline so the caller
 * can trim nothing and still be right.
 */
export const READ_DAEMON_SECRET =
  `node -e 'const c=require(process.env.HOME+"/.omnitron/config.json");` +
  `process.stdout.write((c.auth&&c.auth.jwtSecret)||"")'`;

/**
 * Mint a token in the shape a daemon verifies.
 *
 * Deliberately short-lived and without a `sid`. A master daemon validates
 * `sid` against its session table; a slave has no session store and skips
 * that check — so a token carrying a session id that exists nowhere would
 * work on a slave and be refused by a master, which is the wrong way for a
 * credential to behave. Carrying none is true on both.
 */
export async function mintServiceToken(
  secret: string,
  subject: string,
  ttl = '5m',
): Promise<string> {
  const { SignJWT } = await import('jose');
  return new SignJWT({ role: 'service_role' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setIssuer('omnitron')
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(new TextEncoder().encode(secret));
}

export interface MeshDialerOptions {
  logger: ILogger;
  execution: ExecutionService;
  /** SSH credentials for a node, or null when the master has none. */
  sshTargetFor: (target: MeshTarget) => Promise<SSHTarget | null>;
  /** Names the master in the `sub` claim, so a node's log says who called. */
  subject: string;
  /** Budget for public liveness when no SSH registration exists. */
  directProbeTimeoutMs?: number;
}

export function createMeshDialer(options: MeshDialerOptions): MeshDialer {
  const { logger, execution, sshTargetFor, subject } = options;
  const probeTimeout = options.directProbeTimeoutMs ?? 2_000;
  /** Per node, so one unreadable node does not cost every other one a read. */
  const secrets = new Map<string, { identity: string; secret: string }>();

  return async (target: MeshTarget): Promise<MeshLink> => {
    const key = `${target.host}:${target.port}`;
    const ssh = await sshTargetFor(target);
    if (!ssh) {
      if (await probeTcp(target.host, target.port, probeTimeout)) return directLink(target);
      throw new Error(`${key} is not reachable on its daemon port, and this master holds no SSH credentials for it`);
    }

    const identity = JSON.stringify([target.nodeId ?? null, ssh.host, ssh.port ?? 22, ssh.username ?? 'root', ssh.expectedHostFingerprint ?? null]);
    // A reachable management port is still plaintext. Establish the tunnel before
    // reading a credential, and release it if credential setup or validation fails.
    const tunnel = await execution.tunnel(ssh, target.port);
    try {
      const url = tcpEndpoint(tunnel.host, tunnel.port);
      assertMeshCredentialEndpoint(url);
      const token = await tokenFor(key, identity, ssh);
      const expiresAt = token ? decodeJwt(token).exp! * 1000 : undefined;
      const refreshCredential = token ? async () => {
        const renewed = await tokenFor(key, identity, ssh);
        if (!renewed) throw new Error('Node service credential could not be renewed');
        return { token: renewed, expiresAt: decodeJwt(renewed).exp! * 1000 };
      } : undefined;
      const onRejected = (reason?: string) => {
        if (secrets.get(key)?.identity === identity) secrets.delete(key);
        logger.warn(
          // The node's own words for the refusal. Without them this line names
          // a conclusion and withholds the evidence for it, and the next
          // question — WHY did it refuse — has nowhere to go.
          { host: target.host, reason: reason ?? 'no reason given' },
          'Node refused the master credential — its signing secret will be read again on the next attempt',
        );
      };

      logger.info({ host: target.host, daemonPort: target.port, via: 'ssh-tunnel' }, 'Node daemon reached over SSH');
      return { url, token, expiresAt, refreshCredential, via: 'ssh-tunnel', close: tunnel.close, onRejected };
    } catch (error) {
      await tunnel.close();
      throw error;
    }
  };

  async function tokenFor(key: string, identity: string, ssh: SSHTarget): Promise<string | undefined> {
    const cached = secrets.get(key);
    if (cached?.identity === identity) return mintServiceToken(cached.secret, subject);

    const result = await execution.ssh(ssh, READ_DAEMON_SECRET, { timeout: 20_000, quiet: true });
    const secret = result.stdout.trim();
    if (result.exitCode !== 0 || secret === '') {
      // Not fatal: a node may legitimately have no auth configured, and the
      // connection is still worth having for `ping` and the fleet view. What
      // it cannot do is pull data, and the log has to say which of the two
      // states this is.
      logger.warn(
        { host: ssh.host, exitCode: result.exitCode },
        'Could not read the node daemon signing secret — the mesh link will connect unauthenticated and cannot replicate',
      );
      return undefined;
    }

    secrets.set(key, { identity, secret });
    return mintServiceToken(secret, subject);
  }
}

/**
 * A stable uuid for a node the master has no registry entry for.
 *
 * The master stores replicated rows against `logs.nodeId`, which is a `uuid`
 * column, and a slave identifies itself as `${hostname}-${port}`. Every
 * ingest of every entry therefore failed with
 *
 *     invalid input syntax for type uuid: "sample-cpp-9700"
 *
 * — measured, on a real pull, once the transport and the credential were
 * working and there was finally something for this to be wrong about. The
 * entries were left unacknowledged and stayed on the node, which is the one
 * part of this that behaved.
 *
 * A node the console registered has a `randomUUID()` of its own, and that is
 * what the master should label its data with: it is the id the node list,
 * the charts and the log filters all join on. A node that arrived through a
 * STACK has no such row — the stack config carries a host and a port — and
 * for those this derives an id from the address instead. Deterministic, so
 * the same node lands in the same series across restarts; RFC 4122 v5, so
 * it is a real uuid rather than something shaped like one.
 *
 * It will not match a registry row, and that is honest: no such row exists.
 */
const NODE_NAMESPACE = 'b4d4a3c1-8f2e-4c77-9a1f-0e6d5b2c7a30';

/**
 * RFC 4122 name-based uuid, version 5.
 *
 * Exported with the namespace as a parameter so a test can run it against
 * the published vector — `v5("www.example.com", DNS)` is
 * `2ed6657d-e927-568b-95e1-2665a8aea6a2` — rather than against a second copy
 * of the same arithmetic written in the test, which would agree with itself
 * whatever either of them did.
 */
export function uuidV5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const bytes = Buffer.from(
    createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function stableNodeUuid(host: string, port: number): string {
  return uuidV5(NODE_NAMESPACE, `${host}:${port}`);
}
