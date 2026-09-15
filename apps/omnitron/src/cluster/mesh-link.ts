/**
 * How a master reaches a node's daemon, and what it presents when it gets
 * there.
 *
 * Both halves were missing, and each hid the other.
 *
 * TRANSPORT. `SlaveConnector` dials `tcp://<host>:<port>` directly. A node on
 * the public internet normally permits SSH and little else — the first one
 * provisioned by this code allows 22/tcp and three ports from one private
 * address — so the daemon port is unreachable and the connection times out.
 * Nothing above reads that as "the mesh cannot form": the node answers SSH,
 * deploys, reports healthy, and replicates nothing.
 *
 * CREDENTIAL. Past the transport, `OmnitronSync.drainBuffer` answers
 * `Authentication required`. It is declared for `admin | operator |
 * service_role`, and the master had no token any node would accept. The
 * comment on that endpoint has said so since it was written: "`service_role`
 * cannot be presented today … this is one end of an unfinished cross-daemon
 * path". This is the other end.
 *
 * A daemon persists its own `auth.jwtSecret` in `~/.omnitron/config.json` and
 * verifies HS256 tokens issued `omnitron` against it. The master already
 * holds root SSH for every node it provisioned — that is how it put the
 * daemon there — so it can read that secret and mint a short-lived
 * `service_role` token. This grants the master nothing it did not already
 * have: whoever can run `omnitron up` on a machine can read the file.
 *
 * Measured against the live node, in this order:
 *
 *     direct tcp://37.27.130.185:9700        → connection timeout
 *     through the tunnel, OmnitronDaemon.ping → v0.2.0+local.de0ccff6b022…
 *     OmnitronSync.drainBuffer, no token      → Authentication required
 *     OmnitronSync.drainBuffer, service_role  → 2 entries
 */

import net from 'node:net';
import { createHash } from 'node:crypto';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { ExecutionService, SSHTarget } from '../execution/execution.service.js';

/** One way in to one node, and how to give it back. */
export interface MeshLink {
  /** The address to hand netron. */
  url: string;
  /** Presented with `runTask('authenticate')`, when the node needs one. */
  token?: string | undefined;
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
  onRejected?: (() => void) | undefined;
  /** Releases whatever was opened to make `url` work. */
  close?: (() => Promise<void>) | undefined;
}

export interface MeshTarget {
  host: string;
  /** The daemon's TCP port on the node. */
  port: number;
}

export type MeshDialer = (target: MeshTarget) => Promise<MeshLink>;

/** The transport that needs nothing arranged. */
export const directLink = async (target: MeshTarget): Promise<MeshLink> => ({
  url: `tcp://${target.host}:${target.port}`,
  via: 'direct',
});

/**
 * Can a TCP connection be made, within a budget?
 *
 * Its own probe rather than "try netron and see": a netron connect that
 * fails has already built a Netron, registered a transport and started a
 * handshake, and the failure surfaces as a protocol timeout that reads like
 * a broken daemon. A refused or timed-out socket is the plain fact, and it
 * is what decides between the two transports.
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
  /** How long to wait on a direct connection before reaching for SSH. */
  directProbeTimeoutMs?: number;
}

/**
 * Build the dialer the connector uses: direct where direct works, SSH where
 * it does not.
 *
 * Direct is tried first on every connect rather than remembered, because
 * which one works is a property of the network at this moment — a firewall
 * rule changes, a node moves onto the cluster's private side — and a cached
 * answer to that question is a node that stays on the slow path forever, or
 * one that stops connecting at all.
 *
 * A node the master has no SSH credentials for still gets a direct link:
 * that is the cluster case, where nodes share a private network and the
 * console never held a password. Failing instead would be refusing to do
 * the thing that had always worked.
 */
export function createMeshDialer(options: MeshDialerOptions): MeshDialer {
  const { logger, execution, sshTargetFor, subject } = options;
  const probeTimeout = options.directProbeTimeoutMs ?? 2_000;
  /** Per node, so one unreadable node does not cost every other one a read. */
  const secrets = new Map<string, string>();

  return async (target: MeshTarget): Promise<MeshLink> => {
    const key = `${target.host}:${target.port}`;
    const ssh = await sshTargetFor(target).catch(() => null);

    const token = ssh ? await tokenFor(key, ssh) : undefined;
    const onRejected = () => {
      secrets.delete(key);
      logger.warn(
        { host: target.host },
        'Node refused the master credential — its signing secret will be read again on the next attempt',
      );
    };

    if (await probeTcp(target.host, target.port, probeTimeout)) {
      return { url: `tcp://${target.host}:${target.port}`, token, via: 'direct', onRejected };
    }

    if (!ssh) {
      // Say which door was tried. "Connection refused" against a node that
      // is plainly up sends an operator to the daemon; the answer is the
      // firewall, or a credential this master does not hold.
      throw new Error(
        `${key} is not reachable on its daemon port, and this master holds no SSH credentials for it`,
      );
    }

    const tunnel = await execution.tunnel(ssh, target.port);
    logger.info(
      { host: target.host, daemonPort: target.port, via: 'ssh-tunnel' },
      'Node daemon reached over SSH — its daemon port is not open to this master',
    );
    return {
      url: `tcp://${tunnel.host}:${tunnel.port}`,
      token,
      via: 'ssh-tunnel',
      close: tunnel.close,
      onRejected,
    };
  };

  async function tokenFor(key: string, ssh: SSHTarget): Promise<string | undefined> {
    const cached = secrets.get(key);
    if (cached) return mintServiceToken(cached, subject);

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

    secrets.set(key, secret);
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
 *     invalid input syntax for type uuid: "daos-cpp-9700"
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
