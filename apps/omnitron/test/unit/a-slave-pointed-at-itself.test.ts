/**
 * Every provisioned slave was told the master was itself.
 *
 * A slave's generated config carries `master: { host, port }` — the only way
 * it knows where to send the metrics, logs and events it collects. Both
 * provisioning call sites computed the host like this:
 *
 *     const masterHost = dc.host === '0.0.0.0' ? 'auto' : dc.host;
 *     provisionSlaveNode(node, masterHost === 'auto' ? node.host : masterHost, …)
 *
 * `node.host` is the SLAVE's address. So a master bound to all interfaces —
 * which is every master with remote slaves, since one bound to loopback
 * cannot serve them — wrote the slave's own address into the slave's master
 * field. The comment beside it read "slave uses its own view of master",
 * which is the right idea and the wrong value.
 *
 * Nothing about that fails loudly. The slave starts, supervises its apps,
 * buffers everything it collects and retries a connection that cannot
 * succeed; the console shows a node that never has anything to say, which is
 * indistinguishable from a healthy node on a quiet host. This is the second
 * time today that shape has turned up in the replication path — the first was
 * a buffer with no producer.
 */

import { describe, it, expect, vi } from 'vitest';

import { resolveMasterHost, isWildcardHost, isPrivateAddress } from '../../src/services/master-address.js';

const node = { host: '203.0.113.7', sshPort: 22 };

describe('resolving the address a slave will dial', () => {
  it('never answers with the slave’s own address', async () => {
    // The defect itself. Whatever the sources say, the one answer that cannot
    // be right is the machine being provisioned.
    const probe = vi.fn(async () => '192.0.2.10');
    const resolved = await resolveMasterHost({ bindHost: '0.0.0.0' }, node, probe);

    expect(resolved.host).not.toBe(node.host);
    expect(resolved.host).toBe('192.0.2.10');
  });

  it('prefers what the operator declared', async () => {
    // The only source that can be right behind NAT or a load balancer: the
    // daemon sees its own bind, not the path back to it.
    const probe = vi.fn(async () => '10.0.0.5');
    const resolved = await resolveMasterHost(
      { advertiseHost: 'omnitron.example.com', bindHost: '0.0.0.0' },
      node,
      probe,
    );

    expect(resolved).toEqual({ host: 'omnitron.example.com', source: 'advertiseHost' });
    expect(probe, 'a declared address needs no discovery').not.toHaveBeenCalled();
  });

  it('uses the bind address when it names one interface', async () => {
    const probe = vi.fn(async () => '10.0.0.5');
    const resolved = await resolveMasterHost({ bindHost: '192.0.2.10' }, node, probe);

    expect(resolved).toEqual({ host: '192.0.2.10', source: 'bindHost' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('discovers the route when the master binds everything', async () => {
    const probe = vi.fn(async () => '192.0.2.10');
    const resolved = await resolveMasterHost({ bindHost: '0.0.0.0' }, node, probe);

    expect(resolved).toEqual({ host: '192.0.2.10', source: 'route' });
    // Asked about the node being provisioned — "which of my addresses can
    // THIS machine see" is the question, and it has a different answer per
    // node on a master with several interfaces.
    expect(probe).toHaveBeenCalledWith('203.0.113.7', 22);
  });

  it('answers "nowhere" when the master listens only on loopback', async () => {
    // Discovering a route here would produce an address that is real and
    // useless: no remote node can reach 127.0.0.1.
    //
    // This used to THROW, and that was right while replication was assumed
    // to be push. It is pull: the master opens the connection to each node,
    // over SSH when the node's daemon port is closed, and drains its buffer.
    // A master behind NAT — which is where remote stacks are started from —
    // cannot be dialled and does not need to be. Measured while deploying to
    // the test server: "Refusing to provision 37.27.130.185: this daemon
    // listens on 127.0.0.1", from a master that was connected to that node
    // and pulling its metrics as it said so.
    const resolved = await resolveMasterHost({ bindHost: '127.0.0.1' }, node, async () => '127.0.0.1');

    expect(resolved.host).toBeNull();
    expect(resolved.source).toBe('unreachable');
    // The refusal was still the right thing to SAY. It is a reason now, for
    // the caller to report once, rather than a stop.
    expect(resolved.reason).toMatch(/no node can dial it/i);
    expect(resolved.reason).toMatch(/pulls/i);
  });

  it('answers "nowhere" when no route can answer', async () => {
    // The alternative is NOT provisioning a fleet of slaves pointed
    // somewhere wrong — that is what returning a guess would be. It is
    // provisioning them with no address at all, which is honest and is what
    // a pulled-from node needs.
    const resolved = await resolveMasterHost({ bindHost: '0.0.0.0' }, node, async () => null);

    expect(resolved.host).toBeNull();
    expect(resolved.reason).toMatch(/no route/i);
  });

  it('treats a wildcard advertiseHost as no answer at all', async () => {
    // `advertiseHost: '0.0.0.0'` is a bind address in the wrong field, and
    // writing it into a slave's config produces a slave that dials nothing.
    const resolved = await resolveMasterHost(
      { advertiseHost: '0.0.0.0', bindHost: '192.0.2.10' },
      node,
      async () => null,
    );

    expect(resolved).toEqual({ host: '192.0.2.10', source: 'bindHost' });
  });

  it('answers "nowhere" for a private master address and a public node', async () => {
    // Measured while building this: the route from this workstation to the
    // test host at 37.27.130.185 leaves from 10.8.1.1 — a VPN address behind
    // NAT. Writing it into the slave's config produces a file that looks
    // filled in, parses, starts, and dials an address that does not exist
    // from where the slave stands. Route discovery answers "which of my
    // addresses reaches you"; it cannot answer "which of my addresses can you
    // reach", and when ours is private and yours is not, the answer is none.
    const resolved = await resolveMasterHost(
      { bindHost: '0.0.0.0' },
      { host: '37.27.130.185', sshPort: 22 },
      async () => '10.8.1.1',
    );

    // The distinction the reason has to keep: the address is real, and it is
    // unreachable from where the node stands. Writing it in would produce a
    // config that parses and dials nothing, and the failure would arrive as
    // an empty console days later.
    expect(resolved.host).toBeNull();
    expect(resolved.reason).toContain('10.8.1.1');
    expect(resolved.reason).toMatch(/private address a public host cannot reach/i);
  });

  it('never hands a node an address, rather than a wrong one', async () => {
    // Every path that cannot answer returns null. A guess here is the
    // failure this file is named after: a slave pointed at itself, which
    // starts, parses, retries forever and reports nothing.
    for (const probe of [async () => null, async () => '10.8.1.1', async () => '127.0.0.1']) {
      const resolved = await resolveMasterHost({ bindHost: '127.0.0.1' }, node, probe);
      expect(resolved.host).toBeNull();
      expect(resolved.reason).toBeTruthy();
    }
  });

  it('allows a private master address for a node on the same network', async () => {
    // Two machines on one LAN is the ordinary case, and 10.x is the right
    // answer there.
    const resolved = await resolveMasterHost(
      { bindHost: '0.0.0.0' },
      { host: '10.8.1.42', sshPort: 22 },
      async () => '10.8.1.1',
    );

    expect(resolved).toEqual({ host: '10.8.1.1', source: 'route' });
  });

  it('knows which addresses only work inside a network', () => {
    for (const priv of ['10.8.1.1', '192.168.0.10', '172.16.0.1', '172.31.255.1', '127.0.0.1',
                        '169.254.1.1', '100.64.0.1', 'localhost', '::1', 'fd00::1', 'fe80::1']) {
      expect(isPrivateAddress(priv), priv).toBe(true);
    }
    for (const pub of ['37.27.130.185', '8.8.8.8', '172.32.0.1', '100.128.0.1', '192.169.0.1',
                       'omnitron.example.com']) {
      expect(isPrivateAddress(pub), pub).toBe(false);
    }
  });

  it('knows which spellings mean "every interface"', () => {
    for (const wildcard of ['0.0.0.0', '::', '[::]', '*', '', '  ', undefined]) {
      expect(isWildcardHost(wildcard as string | undefined), String(wildcard)).toBe(true);
    }
    for (const real of ['192.0.2.10', 'omnitron.example.com', '127.0.0.1']) {
      expect(isWildcardHost(real), real).toBe(false);
    }
  });
});
