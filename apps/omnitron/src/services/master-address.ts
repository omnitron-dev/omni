/**
 * The address a slave should dial to reach this master.
 *
 * A slave's generated config carries `master: { host, port }`, and it is the
 * only way it knows where to send its metrics, logs and events. Getting it
 * wrong does not fail loudly: the slave starts, supervises its apps, buffers
 * everything it collects, and retries a connection that cannot succeed. The
 * console shows a node that simply never has anything to say — the same
 * picture as a healthy node on a quiet host.
 *
 * Both call sites computed it like this:
 *
 *     const masterHost = dc.host === '0.0.0.0' ? 'auto' : dc.host;
 *     ...
 *     provisionSlaveNode(node, masterHost === 'auto' ? node.host : masterHost, ...)
 *
 * `node.host` is the SLAVE's address. So a master that binds all interfaces —
 * which is every master that has remote slaves at all, because a master bound
 * to loopback cannot serve them — told each slave that the master was itself.
 * The comment beside it read "slave uses its own view of master", which is
 * the right idea and the wrong value.
 *
 * The ways to know, in the order they are trusted:
 *
 *  1. `daemon.advertiseHost`, if the operator set it. Nothing else can be
 *     right when the master is behind NAT or a load balancer: only a human
 *     knows the address that reaches it from outside.
 *  2. `daemon.host`, when it names one interface. A master bound to
 *     192.0.2.10 is reachable at 192.0.2.10.
 *  3. The local address of a route to the node. Opening a TCP connection to
 *     the machine we are about to provision and asking the kernel which of
 *     our addresses it used answers "which of my addresses can this node see"
 *     — for a directly-routable master, exactly right.
 *
 * And when none of them answers, it raises. A deployment that stops with
 * "set daemon.advertiseHost" costs an operator a minute; one that silently
 * provisions a fleet of slaves pointed at themselves costs an afternoon, and
 * gives no clue where to look.
 */

import net from 'node:net';

/** Addresses that mean "every interface" rather than a reachable host. */
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]', '*', '']);

export interface MasterAddressSources {
  /** `daemon.advertiseHost` — what the operator says reaches this master. */
  advertiseHost?: string | undefined;
  /** `daemon.host` — the bind address. */
  bindHost?: string | undefined;
}

export function isWildcardHost(host: string | undefined): boolean {
  return host == null || WILDCARD_HOSTS.has(host.trim());
}

/**
 * Ask the kernel which of our addresses reaches `host`.
 *
 * No data is sent: the connection is opened and destroyed. A firewall that
 * refuses still tells us what we need, because `localAddress` is assigned at
 * connect time — but a connection that never resolves tells us nothing, hence
 * the deadline.
 */
export async function localAddressToward(
  host: string,
  port: number,
  timeoutMs = 5_000,
): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (value: string | null) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => done(null));
    socket.once('connect', () => {
      const local = socket.localAddress ?? null;
      // An IPv6-mapped IPv4 address (`::ffff:192.0.2.10`) is the same address
      // wearing a different notation, and a config file is easier to read
      // without it.
      done(local && local.startsWith('::ffff:') ? local.slice('::ffff:'.length) : local);
    });
    socket.once('error', () => done(null));
  });
}

/**
 * Resolve the master address to write into a slave's config.
 *
 * @param sources  what the daemon's own configuration says
 * @param node     the slave being provisioned: used only to discover which of
 *                 our addresses can reach it, never as the answer itself
 * @throws Error naming the setting to add, when nothing can answer
 */
export async function resolveMasterHost(
  sources: MasterAddressSources,
  node: { host: string; sshPort?: number | undefined },
  probe: (host: string, port: number) => Promise<string | null> = localAddressToward,
): Promise<{ host: string; source: 'advertiseHost' | 'bindHost' | 'route' }> {
  const advertised = sources.advertiseHost?.trim();
  if (advertised && !isWildcardHost(advertised)) {
    return { host: advertised, source: 'advertiseHost' };
  }

  const bind = sources.bindHost?.trim();
  if (bind && !isWildcardHost(bind) && bind !== '127.0.0.1' && bind !== 'localhost' && bind !== '::1') {
    return { host: bind, source: 'bindHost' };
  }

  // A master bound to loopback cannot be reached by any slave, so discovering
  // a route to the node would produce an address that is real and useless.
  if (bind === '127.0.0.1' || bind === 'localhost' || bind === '::1') {
    throw new Error(
      `Refusing to provision ${node.host}: this daemon listens on ${bind}, which no remote node can reach. ` +
        `Bind it to a routable interface (daemon.host) and set daemon.advertiseHost to the address slaves should dial.`,
    );
  }

  const routed = await probe(node.host, node.sshPort ?? 22);
  if (routed && !isWildcardHost(routed)) {
    // A route tells us which of our addresses reaches the node. It does not
    // tell us that the node can reach US at that address, and when ours is
    // private and the node is not, it positively cannot.
    //
    // Measured 2026-09-14, provisioning the test host from this workstation:
    // the route to 37.27.130.185 leaves from 10.8.1.1 — a VPN address behind
    // NAT. Handing that to the slave produces a config that looks filled in,
    // parses, starts, and dials an address that does not exist from where it
    // stands. The failure would arrive as an empty console, days later.
    if (isPrivateAddress(routed) && !isPrivateAddress(node.host)) {
      throw new Error(
        `Refusing to provision ${node.host}: the route to it leaves this master at ${routed}, ` +
          `which is a private address and unreachable from a public host. ` +
          `Set daemon.advertiseHost to the address ${node.host} can dial to reach this daemon.`,
      );
    }
    return { host: routed, source: 'route' };
  }

  throw new Error(
    `Refusing to provision ${node.host}: cannot determine the address slaves should use to reach this master. ` +
      `Set daemon.advertiseHost to the address this daemon is reachable at from ${node.host}.`,
  );
}

/**
 * Whether an address is one that only works inside a network.
 *
 * Hostnames answer `false`: a name can resolve to anything, and refusing one
 * on suspicion would block the ordinary case where an operator gave a real
 * DNS name. This exists to catch the address we DISCOVERED, which is always
 * numeric.
 */
export function isPrivateAddress(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (h === 'localhost' || h === '::1') return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;

  const octets = h.split('.');
  if (octets.length !== 4) return false;
  const [a, b] = octets.map((o) => Number(o));
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false;

  if (a === 10 || a === 127) return true;                    // private, loopback
  if (a === 192 && b === 168) return true;                   // private
  if (a === 172 && b! >= 16 && b! <= 31) return true;        // private
  if (a === 169 && b === 254) return true;                   // link-local
  if (a === 100 && b! >= 64 && b! <= 127) return true;       // carrier-grade NAT
  return false;
}
