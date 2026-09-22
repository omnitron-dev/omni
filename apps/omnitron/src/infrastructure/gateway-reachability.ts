/**
 * The gateway is a container; the apps it proxies to are host processes.
 *
 * That crossing is the one path in a remote stack that no amount of correct
 * configuration can open by itself, because it leaves docker entirely: a
 * packet from the gateway's network to a port on the host goes through the
 * host's INPUT chain, and a hardened host drops it.
 *
 * Measured on the test node, with everything else finally right — six apps
 * installed, five running, the portal served, the schema in place:
 *
 *     ss -tlnp        LISTEN 0 511 0.0.0.0:3001 … 0.0.0.0:3007
 *     from the host   curl 172.19.0.1:3001 -> 404   (the app answers)
 *     from the gateway wget 172.19.0.1:3001 -> timed out
 *     ufw status      Status: active
 *                     22/tcp  ALLOW  Anywhere
 *     iptables -L INPUT   Chain INPUT (policy DROP)
 *
 * Every `/api/*` request answered `503 SERVICE_UNAVAILABLE` after three
 * seconds — correctly, from the gateway's point of view, and with no hint
 * anywhere that the upstream it could not reach was listening and healthy on
 * the same machine.
 *
 * This is not something to leave to whoever deploys next. A stack that
 * declares a container gateway in front of host applications has declared
 * that path, and the deployment that creates the gateway is the only moment
 * anything knows both halves: the network the gateway lands on and the ports
 * the apps bind.
 *
 * The rule is as narrow as the fact: FROM the stack's own docker subnet, TO
 * the app ports, TCP. Nothing is opened to the internet, and a host with no
 * firewall needs nothing done to it.
 */

/** The ports a gateway proxies to, as `resolveGateway` declares them. */
export const GATEWAY_UPSTREAM_PORTS = [3001, 3002, 3003, 3004, 3005, 3006, 3007] as const;

export interface ReachabilityRule {
  /** The docker network the gateway is on, e.g. `172.19.0.0/16`. */
  readonly subnet: string;
  readonly fromPort: number;
  readonly toPort: number;
  /** What the rule is for, carried into the firewall so a reader can tell. */
  readonly comment: string;
}

/**
 * A CIDR this is willing to open a path from.
 *
 * Private ranges only, and a prefix that actually narrows: `0.0.0.0/0` is
 * not a docker subnet, and neither is a public address. A malformed or
 * unexpected answer from `docker network inspect` must not become a firewall
 * rule — the whole point of deriving the subnet is that it is narrow.
 */
export function isPrivateSubnet(cidr: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) return false;
  const [a, b, c, d, bits] = m.slice(1).map(Number) as [number, number, number, number, number];
  if ([a, b, c, d].some((n) => n > 255)) return false;
  if (bits < 8 || bits > 32) return false;

  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * The rule a stack needs, or null when it needs none.
 *
 * Null for a subnet this does not recognise, because a rule derived from an
 * answer nobody can explain is worse than an unreachable gateway: one is a
 * visible failure, the other is a hole.
 */
export function reachabilityRule(subnet: string, project: string, stack: string): ReachabilityRule | null {
  if (!isPrivateSubnet(subnet)) return null;
  return {
    subnet: subnet.trim(),
    fromPort: GATEWAY_UPSTREAM_PORTS[0],
    toPort: GATEWAY_UPSTREAM_PORTS[GATEWAY_UPSTREAM_PORTS.length - 1]!,
    comment: `omnitron: ${project}/${stack} gateway -> host apps`,
  };
}

/**
 * The shell that applies it, idempotently and only where it is needed.
 *
 * `ufw status` decides: a host without ufw, or with it inactive, is not
 * dropping the traffic and needs nothing. `ufw` itself is idempotent for an
 * identical rule, and the grep makes that visible rather than relying on it.
 *
 * Every failure is swallowed into a message rather than a non-zero exit: a
 * deployment must not be stopped by a firewall it could not read, and the
 * gateway's own 503 will say the rest.
 *
 * But a firewall it could not READ is not a firewall that is off. This asked
 * `ufw status 2>/dev/null | head -1 | grep -q 'Status: active'`: a pipeline's
 * status is its last command's, and `2>/dev/null` threw away the only line
 * that said why. A `ufw status` that failed — a deploy user who is not root
 * gets «ERROR: You need to be root to run this script» — printed nothing, the
 * grep found nothing, and the answer was `ufw-inactive`: no rule added, every
 * /api/* request dropped by an ACTIVE firewall, and the one explanation on
 * record saying there was nothing to drop them. The status is now read once,
 * its exit checked, and a failure reported as `ufw-unreadable: <its first
 * line>`. (`ufw_status`, not `status`: that name is read-only in zsh, which
 * is what an SSH command runs under when it is the account's shell.)
 */
export function reachabilityCommand(rule: ReachabilityRule): string {
  const spec = `from ${rule.subnet} to any port ${rule.fromPort}:${rule.toPort} proto tcp`;
  return [
    `if ! command -v ufw >/dev/null 2>&1; then echo 'no-ufw'; exit 0; fi`,
    `if ! ufw_status=$(ufw status 2>&1); then echo "ufw-unreadable: $(printf '%s\\n' "$ufw_status" | head -1)"; exit 0; fi`,
    `if ! printf '%s\\n' "$ufw_status" | head -1 | grep -q 'Status: active'; then echo 'ufw-inactive'; exit 0; fi`,
    // Subnet and ports on one line, in either order: `ufw status` prints the
    // port (To) before the source (From), and the pattern this was —
    // `<subnet>.*<ports>` — never matched a rule ufw had printed. Every
    // deployment asked ufw for the rule again (it skips one it has, exit 0)
    // and logged «Opened the gateway's path» for a path open all along.
    `if printf '%s\\n' "$ufw_status" | grep -F '${rule.subnet}' | grep -qF '${rule.fromPort}:${rule.toPort}'; then echo 'already-allowed'; exit 0; fi`,
    `ufw allow ${spec} comment '${rule.comment}' >/dev/null 2>&1 && echo 'allowed' || echo 'failed'`,
  ].join('; ');
}
