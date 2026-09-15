/**
 * The torrc was assembled by shell inside the container, so nothing could
 * read it and nothing could test it.
 *
 * It arrived as a JSON list that a `jq` loop turned into stanzas at startup.
 * That put the one file which decides whether an onion service is anonymous
 * behind a script that could not be inspected without starting a container —
 * and a hardening line dropped by a quoting mistake looks exactly like one
 * that was never written.
 *
 * Every option asserted here is real, checked against Tor 0.4.9.12 — the
 * version Alpine 3.21 installs, measured rather than assumed.
 *
 * The threat this is written against is an adversary who wants to learn
 * which host runs the service, or to make it stop. Not one who already has
 * the host: that one has the keys, and no torrc helps.
 */

import { describe, it, expect } from 'vitest';

import { renderTorrc, authorizedClientFiles } from '../../src/infrastructure/presets/torrc.js';

const service = { name: 'portal', virtualPort: 80, target: 'daos-test-gateway:80' };
const torrc = renderTorrc({ services: [service] });
const has = (line: string) => expect(torrc.split('\n').map((l) => l.trim())).toContain(line);

describe('what the process is not', () => {
  it('is not a proxy, a relay, or a directory', () => {
    // A SOCKS port makes the host an open proxy on its docker network; an
    // ORPort makes it a relay, which publishes its address in the consensus
    // — the one fact an onion service exists to withhold.
    has('SocksPort 0');
    has('ORPort 0');
    has('DirPort 0');
    has('ControlPort 0');
    has('PublishServerDescriptor 0');
    has('ExitPolicy reject *:*');
  });
});

describe('anonymity', () => {
  it('never runs single-hop', () => {
    // Single-hop trades the service's anonymity for latency. Named
    // explicitly so enabling it is a visible edit rather than an omission.
    has('HiddenServiceSingleHopMode 0');
    has('HiddenServiceNonAnonymousMode 0');
  });

  it('keeps full padding', () => {
    // Padding hides the shape of traffic from whoever can watch the link to
    // the guard. The reduced variants exist for battery-powered clients and
    // cost anonymity; a server has no reason to take that trade.
    has('ConnectionPadding 1');
    has('ReducedConnectionPadding 0');
    has('CircuitPadding 1');
    has('ReducedCircuitPadding 0');
  });

  it('stays on one address family', () => {
    // A host reachable both ways is two chances to be correlated, and onion
    // traffic needs neither.
    has('ClientUseIPv6 0');
    has('ClientUseIPv4 1');
  });

  it('keeps entry guards', () => {
    // Guard discovery is the attack that finds the host behind a service:
    // watch which relays it builds through, narrow the set, attack what is
    // left. Guards are what make that expensive.
    has('UseEntryGuards 1');
    has('EnforceDistinctSubnets 1');
  });
});

describe('what is written down', () => {
  it('scrubs addresses and never logs below notice', () => {
    // `info` and `debug` log circuits and streams. A debug log from an onion
    // service is a deanonymisation waiting to be read by whoever gets the
    // file.
    has('SafeLogging 1');
    has('Log notice stdout');
    expect(torrc).not.toMatch(/^Log (info|debug)/m);
  });

  it('keeps the data directory to itself', () => {
    has('DataDirectoryGroupReadable 0');
    has('AvoidDiskWrites 1');
  });
});

describe('the service itself', () => {
  it('is v3 and points at its backend', () => {
    // v2 was removed from Tor, and its addresses were 80-bit truncated
    // hashes — brute-forceable to a lookalike.
    has('HiddenServiceVersion 3');
    has('HiddenServiceDir /var/lib/tor/portal');
    has('HiddenServicePort 80 daos-test-gateway:80');
    has('HiddenServiceDirGroupReadable 0');
  });

  it('defends the introduction point', () => {
    // Where the service is cheapest to attack: anyone may ask an intro point
    // to relay an introduction, and the service pays to answer. Neither
    // defence is on by default.
    has('HiddenServiceEnableIntroDoSDefense 1');
    has('HiddenServicePoWDefensesEnabled 1');
    expect(torrc).toMatch(/HiddenServiceEnableIntroDoSRatePerSec \d+/);
    expect(torrc).toMatch(/HiddenServicePoWQueueRate \d+/);
  });

  it('caps what one client can hold open', () => {
    has('HiddenServiceMaxStreamsCloseCircuit 1');
    expect(torrc).toMatch(/HiddenServiceMaxStreams \d+/);
  });

  it('describes each service separately', () => {
    const two = renderTorrc({
      services: [service, { name: 'console', virtualPort: 80, target: 'x:9800' }],
    });

    // Two services share a process and nothing else: separate directories,
    // separate keys, separate onion addresses.
    expect(two).toContain('HiddenServiceDir /var/lib/tor/portal');
    expect(two).toContain('HiddenServiceDir /var/lib/tor/console');
    expect(two.match(/HiddenServiceVersion 3/g)).toHaveLength(2);
  });

  it('lets an operator have the last word', () => {
    const withExtra = renderTorrc({ services: [service], extra: ['SomeFutureOption 1'] });

    // Appended last, so an operator's line wins over a default of ours.
    expect(withExtra.trimEnd().endsWith('SomeFutureOption 1')).toBe(true);
  });
});

describe('client authorization', () => {
  it('is off unless keys are given', () => {
    expect(authorizedClientFiles([service])).toEqual([]);
  });

  it('writes each key where tor reads it', () => {
    const files = authorizedClientFiles([
      { ...service, authorizedClients: ['descriptor:x25519:AAAA', 'descriptor:x25519:BBBB'] },
    ]);

    // Not torrc lines: tor reads these out of the service directory, and a
    // key that never reaches `authorized_clients/` is a restriction that
    // silently does not exist.
    expect(files.map((f) => f.path)).toEqual([
      '/var/lib/tor/portal/authorized_clients/client-1.auth',
      '/var/lib/tor/portal/authorized_clients/client-2.auth',
    ]);
    expect(files[0]!.content).toBe('descriptor:x25519:AAAA\n');
  });
});
