/**
 * `bareMetal` described how a service runs from systemd, and nothing read it.
 *
 * `IBareMetalServiceConfig` has carried `installCommand`, `systemdUnit`,
 * `configFile` + `configTemplate`, `dataDir`, `user`, `validateCommand` and
 * variants keyed by `networkMode` since it was written. Every field of it
 * was read by nothing: the type existed, the preset registry copied it, and
 * no code path ever acted on one. An operator could declare that a service
 * runs from systemd and get a service that did not run at all.
 *
 * It matters because some things should not be containers. A chain daemon on
 * a server is a system service with a data directory measured in hundreds of
 * gigabytes and a lifetime longer than any deployment. Measured on the node
 * this was written for: 106 GB of Monero chain, and a Bitcoin unit pointing
 * at a binary that is not installed.
 *
 * These pin the decisions. Executing them is next door; what is easy to get
 * wrong is deciding to act at all.
 */

import { describe, it, expect } from 'vitest';

import { planBareMetal, isSettled, OMNITRON_CONFIG_MARKER, CONFIG_MODE } from '../../src/infrastructure/bare-metal-plan.js';
import type { BareMetalObservation, BareMetalSpec } from '../../src/infrastructure/bare-metal-plan.js';

const settled: BareMetalObservation = {
  installed: true, userExists: true, dataDirExists: true,
  unitKnown: true, unitActive: true, unitEnabled: true, configContent: null,
};

const spec = (over: Partial<BareMetalSpec> = {}): BareMetalSpec => ({ name: 'bitcoind', ...over });
const observe = (over: Partial<BareMetalObservation> = {}): BareMetalObservation => ({ ...settled, ...over });
const kinds = (p: { actions: Array<{ type: string }> }) => p.actions.map((a) => a.type);

describe('a host that already matches the declaration', () => {
  it('is left alone', () => {
    const plan = planBareMetal(spec({ systemdUnit: 'bitcoind', user: 'bitcoin', dataDir: '/var/lib/bitcoind' }), observe());

    // Reconciling has to be safe to run on every deploy. A plan that always
    // has something to do restarts a chain daemon every time.
    expect(isSettled(plan)).toBe(true);
  });
});

describe('bringing a service into existence', () => {
  it('installs, makes its account, its directory, and starts it', () => {
    const plan = planBareMetal(
      spec({ installCommand: 'apt-get install -y bitcoind', systemdUnit: 'bitcoind', user: 'bitcoin', dataDir: '/var/lib/bitcoind' }),
      observe({ installed: false, userExists: false, dataDirExists: false, unitActive: false, unitEnabled: false }),
    );

    // Order is a dependency order: the account before what it owns.
    expect(kinds(plan)).toEqual(['install', 'create-user', 'create-data-dir', 'enable-unit', 'start-unit']);
  });

  it('says what it cannot do rather than doing nothing', () => {
    const plan = planBareMetal(spec({ systemdUnit: 'bitcoind' }), observe({ installed: false }));

    // The host is fine; the description of it is incomplete. Said that way
    // round, because the operator fixes the declaration, not the machine.
    expect(plan.actions).toEqual([]);
    expect(plan.refusals[0]).toMatch(/not installed and its declaration has no `installCommand`/);
  });

  it('does not claim a unit systemd has never heard of', () => {
    const plan = planBareMetal(spec({ systemdUnit: 'bitcoind' }), observe({ unitKnown: false }));

    // `is-active` cannot tell "not installed" from "installed and stopped",
    // and starting a unit that does not exist fails in a way that reads as
    // the service being broken.
    expect(kinds(plan)).toEqual([]);
    expect(plan.refusals[0]).toMatch(/systemd does not know a unit called/);
  });

  it('never touches a data directory that is already there', () => {
    const plan = planBareMetal(spec({ dataDir: '/var/lib/monero/.bitmonero', user: 'monero' }), observe());

    // 106 GB of chain on the node this was written for.
    expect(kinds(plan)).toEqual([]);
  });
});

describe("a configuration file somebody else wrote", () => {
  const conf = spec({ configFile: '/etc/monero/monerod.conf', configContent: 'rpc-bind-port=28082', systemdUnit: 'monerod', user: 'monero' });

  it('is left exactly alone, and reported', () => {
    const plan = planBareMetal(conf, observe({ configContent: 'p2p-bind-ip=127.0.0.1\nlimit-rate-up=128000' }));

    // It holds decisions this does not know about — which interfaces to
    // bind, whether to relay over Tor. Overwriting it because a template
    // disagrees is how a provisioning tool destroys a working service.
    expect(kinds(plan)).toEqual([]);
    expect(plan.refusals[0]).toContain('was not written by omnitron');
    expect(plan.refusals[0]).toContain(OMNITRON_CONFIG_MARKER);
  });

  it('is adopted once it carries the marker', () => {
    const plan = planBareMetal(conf, observe({ configContent: `${OMNITRON_CONFIG_MARKER}\nrpc-bind-port=1` }));

    expect(kinds(plan)).toEqual(['write-config', 'restart-unit']);
  });
});

describe('a configuration this wrote', () => {
  const conf = spec({ configFile: '/etc/bitcoin/bitcoin.conf', configContent: 'prune=5000', systemdUnit: 'bitcoind', user: 'bitcoin' });

  it('is written with the credentials it holds in mind', () => {
    const plan = planBareMetal(conf, observe({ configContent: null, unitActive: false }));
    const write = plan.actions.find((a) => a.type === 'write-config') as { mode: string; owner: string | undefined; content: string };

    // These files hold RPC credentials. Not world-readable, and owned by the
    // account that needs them.
    expect(write.mode).toBe(CONFIG_MODE);
    expect(write.mode).toBe('0640');
    expect(write.owner).toBe('bitcoin');
    expect(write.content.startsWith(OMNITRON_CONFIG_MARKER)).toBe(true);
  });

  it('restarts the service after the file is in place, not before', () => {
    const plan = planBareMetal(conf, observe({ configContent: `${OMNITRON_CONFIG_MARKER}\nprune=1000` }));

    // A running service holds the configuration it started with.
    expect(kinds(plan)).toEqual(['write-config', 'restart-unit']);
    expect((plan.actions[1] as { because: string }).because).toMatch(/configuration changed/);
  });

  it('does not restart for a difference that is not one', () => {
    const plan = planBareMetal(conf, observe({ configContent: `${OMNITRON_CONFIG_MARKER}\nprune=5000   \n\n` }));

    // Trailing whitespace is the same configuration, and for a chain daemon
    // a restart is minutes of resynchronisation.
    expect(isSettled(plan)).toBe(true);
  });

  it('starts a stopped service rather than restarting it', () => {
    const plan = planBareMetal(conf, observe({ configContent: null, unitActive: false }));

    expect(kinds(plan)).toEqual(['write-config', 'start-unit']);
    expect(kinds(plan)).not.toContain('restart-unit');
  });
});

describe('a template that could not be filled', () => {
  it('is refused, not written', () => {
    const plan = planBareMetal(
      spec({
        configFile: '/etc/bitcoin/bitcoin.conf',
        configContent: 'rpcpassword=${secret:rpc_password}',
        unresolved: ['${secret:rpc_password}'],
        systemdUnit: 'bitcoind',
      }),
      observe({ configContent: null }),
    );

    // `rpcpassword=` starts a mainnet daemon with no password.
    // `rpcpassword=${secret:rpc_password}` starts nothing and says why.
    // Neither belongs on a host.
    expect(kinds(plan)).toEqual([]);
    expect(plan.refusals[0]).toContain('${secret:rpc_password}');
    expect(plan.refusals[0]).toMatch(/placeholder/);
  });
});

describe('rendering a declared config', () => {
  it('fills ports, secrets and paths', async () => {
    const { renderConfigTemplate } = await import('../../src/infrastructure/bare-metal-plan.js');

    const { content, unresolved } = renderConfigTemplate(
      'datadir=${dataDir}\nrpcport=${port:rpc}\nrpcauth=${secret:rpc_auth}\nrpcbind=${bindAddress}',
      { ports: { rpc: 8332 }, secrets: { rpc_auth: 'omni:abc$def' }, dataDir: '/var/lib/bitcoind', bindAddress: '127.0.0.1' },
    );

    expect(content).toBe('datadir=/var/lib/bitcoind\nrpcport=8332\nrpcauth=omni:abc$def\nrpcbind=127.0.0.1');
    expect(unresolved).toEqual([]);
  });

  it('leaves what it could not fill visible, and names it', async () => {
    const { renderConfigTemplate } = await import('../../src/infrastructure/bare-metal-plan.js');

    const { content, unresolved } = renderConfigTemplate('rpcpassword=${secret:missing}\nrpcport=${port:none}', {
      ports: { rpc: 8332 }, secrets: {},
    });

    // Not replaced with an empty string: that is the version that starts a
    // daemon with no password.
    expect(content).toContain('${secret:missing}');
    expect(unresolved.sort()).toEqual(['${port:none}', '${secret:missing}']);
  });

  it('treats an empty secret as unresolved', async () => {
    const { renderConfigTemplate } = await import('../../src/infrastructure/bare-metal-plan.js');

    const { unresolved } = renderConfigTemplate('rpcpassword=${secret:rpc_password}', { secrets: { rpc_password: '' } });

    expect(unresolved).toEqual(['${secret:rpc_password}']);
  });
});

describe('choosing the host variant', () => {
  it('applies the variant for the declared network', async () => {
    const { selectBareMetal } = await import('../../src/infrastructure/bare-metal-plan.js');

    const chosen = selectBareMetal('bitcoin', {
      networkMode: 'mainnet',
      ports: { rpc: 8332 },
      bareMetal: {
        systemdUnit: 'bitcoind',
        dataDir: '/var/lib/bitcoind',
        variants: { mainnet: { dataDir: '/var/lib/bitcoind/mainnet' }, regtest: { dataDir: '/tmp/regtest' } },
      },
    });

    expect(chosen!.systemdUnit).toBe('bitcoind');
    expect(chosen!.dataDir).toBe('/var/lib/bitcoind/mainnet');
  });

  it('says nothing for a service that is not a host service', async () => {
    const { selectBareMetal } = await import('../../src/infrastructure/bare-metal-plan.js');

    // A requirement with only a docker block is a container, and asking this
    // for one must not invent a systemd unit for it.
    expect(selectBareMetal('redis', { networkMode: 'mainnet' })).toBeNull();
  });
});

describe('which network a stack runs a service on', () => {
  it('is the stack s answer, not the application s', async () => {
    const { selectBareMetal } = await import('../../src/infrastructure/bare-metal-plan.js');

    // paysys declares `regtest`, which is right on a laptop. A stack pointed
    // at a server is the only scope that knows otherwise, and before this
    // there was nowhere to say so: the variant was chosen by the
    // application and fixed there.
    const chosen = selectBareMetal(
      'bitcoin',
      {
        networkMode: 'regtest',
        bareMetal: {
          systemdUnit: 'bitcoind',
          dataDir: '/tmp/regtest',
          variants: { mainnet: { dataDir: '/var/lib/bitcoind' } },
        },
      },
      { networkMode: 'mainnet' },
    );

    expect(chosen!.dataDir).toBe('/var/lib/bitcoind');
  });

  it('lets a stack override the host details too', async () => {
    const { selectBareMetal } = await import('../../src/infrastructure/bare-metal-plan.js');

    const chosen = selectBareMetal(
      'bitcoin',
      { networkMode: 'mainnet', bareMetal: { systemdUnit: 'bitcoind', user: 'bitcoin' } },
      { bareMetal: { user: 'satoshi' } },
    );

    // The override is applied last, after the variant, so a stack can
    // correct one field without restating the block.
    expect(chosen!.user).toBe('satoshi');
    expect(chosen!.systemdUnit).toBe('bitcoind');
  });
});

describe('a unit the host does not have', () => {
  const withUnit = spec({
    systemdUnit: 'bitcoind',
    unitContent: '[Service]\nExecStart=/usr/local/bin/bitcoind',
    user: 'bitcoin',
  });

  it('is written, systemd is told, and then the service is started', () => {
    const plan = planBareMetal(withUnit, observe({ unitKnown: false, unitActive: false, unitEnabled: false, unitContent: null }));

    // A binary installed from an upstream tarball ships no unit, and the
    // alternative to declaring one is an `installCommand` that writes a
    // service file as a side effect of "installing" — which is where
    // hardening goes to be forgotten.
    expect(kinds(plan)).toEqual(['write-unit', 'daemon-reload', 'enable-unit', 'start-unit']);
    expect(plan.refusals).toEqual([]);
  });

  it('is left alone when somebody else wrote it', () => {
    const plan = planBareMetal(withUnit, observe({ unitContent: '[Service]\nExecStart=/snap/bin/bitcoin-core.daemon' }));

    // Same rule as a config file and for a stronger reason: a unit somebody
    // else wrote is how their service starts. The node this was written for
    // has exactly such a unit, pointing at a binary that is not installed.
    expect(kinds(plan)).toEqual([]);
    expect(plan.refusals[0]).toContain('was not written by omnitron');
  });

  it('restarts the service when its own unit changes', () => {
    const plan = planBareMetal(withUnit, observe({ unitContent: `${OMNITRON_CONFIG_MARKER}\n[Service]\nExecStart=/old/bitcoind` }));

    expect(kinds(plan)).toEqual(['write-unit', 'daemon-reload', 'restart-unit']);
    expect((plan.actions.at(-1) as { because: string }).because).toMatch(/unit changed/);
  });

  it('still refuses when there is no unit and no template for one', () => {
    const plan = planBareMetal(spec({ systemdUnit: 'bitcoind' }), observe({ unitKnown: false }));

    expect(plan.refusals[0]).toMatch(/provides no `unitTemplate`/);
  });

  it('writes nothing at all when a placeholder is unfilled', () => {
    const plan = planBareMetal(
      spec({ systemdUnit: 'bitcoind', unitContent: 'ExecStart=x --datadir=${dataDir}', unresolved: ['${dataDir}'] }),
      observe({ unitKnown: false, unitContent: null }),
    );

    // A unit naming a data directory it could not resolve starts a chain
    // daemon in the wrong place, and the wrong place is a second copy of
    // the chain.
    expect(kinds(plan)).toEqual([]);
    expect(plan.refusals[0]).toContain('${dataDir}');
  });
});
