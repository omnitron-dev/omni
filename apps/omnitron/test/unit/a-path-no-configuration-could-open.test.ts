/**
 * Every `/api/*` answered 503 while the upstream was healthy on the same host.
 *
 * The gateway is a container; the applications it proxies to are host
 * processes. That crossing is the one path in a remote stack that no amount
 * of correct configuration can open by itself — a packet from the gateway's
 * network to a port on the host goes through the host's INPUT chain, and a
 * hardened host drops it.
 *
 * Measured on the test node with everything else finally right: six apps
 * installed, five running, the portal served over Tor, the schema in place.
 *
 *     ss -tlnp            LISTEN 0 511 0.0.0.0:3001 … 0.0.0.0:3007
 *     from the host       curl 172.19.0.1:3001  -> 404   (the app answers)
 *     from the gateway    wget 172.19.0.1:3001  -> timed out
 *     ufw status          Status: active
 *                         22/tcp  ALLOW  Anywhere
 *     iptables -L INPUT   Chain INPUT (policy DROP)
 *
 * `/api/main/` answered `503 SERVICE_UNAVAILABLE` after three seconds —
 * correct from the gateway's point of view, and with no hint anywhere that
 * the upstream it could not reach was listening and healthy two IP addresses
 * away.
 *
 * A stack that declares a container gateway in front of host applications has
 * declared that path. The deployment that creates the gateway is the only
 * moment anything knows both halves — the network the gateway lands on and
 * the ports the apps bind — so it is the only moment the rule can be as
 * narrow as the fact.
 */

import { describe, it, expect } from 'vitest';

import {
  isPrivateSubnet,
  reachabilityRule,
  reachabilityCommand,
  GATEWAY_UPSTREAM_PORTS,
} from '../../src/infrastructure/gateway-reachability.js';

describe('the rule is as narrow as the fact', () => {
  it('opens only the stack\'s own subnet, and only the app ports', () => {
    const rule = reachabilityRule('172.19.0.0/16', 'daos', 'test');

    expect(rule).not.toBeNull();
    expect(rule!.subnet).toBe('172.19.0.0/16');
    expect(rule!.fromPort).toBe(GATEWAY_UPSTREAM_PORTS[0]);
    expect(rule!.toPort).toBe(GATEWAY_UPSTREAM_PORTS[GATEWAY_UPSTREAM_PORTS.length - 1]);
    expect(rule!.comment).toContain('daos/test');
  });

  it('names itself in the firewall, so a reader can tell whose it is', () => {
    // A rule nobody can attribute is a rule nobody dares remove.
    expect(reachabilityCommand(reachabilityRule('10.5.0.0/16', 'acme', 'prod')!)).toContain(
      'omnitron: acme/prod gateway -> host apps',
    );
  });
});

describe('a subnet it cannot explain is not a rule', () => {
  it('accepts the private ranges docker uses', () => {
    for (const cidr of ['172.17.0.0/16', '172.19.0.0/16', '10.0.0.0/8', '192.168.16.0/20']) {
      expect(isPrivateSubnet(cidr), cidr).toBe(true);
    }
  });

  it('refuses everything else', () => {
    // A rule derived from an answer nobody can explain is worse than an
    // unreachable gateway: one is a visible failure, the other is a hole.
    for (const cidr of [
      '0.0.0.0/0',
      '8.8.8.0/24',
      '37.27.130.0/24',
      '172.32.0.0/16',
      '999.1.1.1/16',
      'not-a-subnet',
      '',
      '172.19.0.0/4',
    ]) {
      expect(isPrivateSubnet(cidr), cidr).toBe(false);
    }
  });

  it('returns no rule at all for one it refuses', () => {
    expect(reachabilityRule('0.0.0.0/0', 'daos', 'test')).toBeNull();
    expect(reachabilityRule('8.8.8.0/24', 'daos', 'test')).toBeNull();
  });
});

describe('it touches a host only where it has to', () => {
  const command = reachabilityCommand(reachabilityRule('172.19.0.0/16', 'daos', 'test')!);

  it('does nothing on a host with no firewall', () => {
    expect(command).toMatch(/command -v ufw/);
    expect(command).toMatch(/no-ufw/);
  });

  it('does nothing on a host whose firewall is not dropping anything', () => {
    expect(command).toMatch(/Status: active/);
    expect(command).toMatch(/ufw-inactive/);
  });

  it('does nothing twice', () => {
    // `ufw` is idempotent for an identical rule; checking first makes that
    // visible in the log instead of a rule added on every deployment.
    expect(command).toMatch(/already-allowed/);
  });

  it('reports rather than failing', () => {
    // A deployment must not stop because a firewall could not be read. The
    // gateway's own 503 will say the rest, and this says which it was.
    expect(command).toMatch(/\|\| echo 'failed'/);
    expect(command).toMatch(/exit 0/);
  });

  it('opens tcp only', () => {
    expect(command).toContain('proto tcp');
  });
});
