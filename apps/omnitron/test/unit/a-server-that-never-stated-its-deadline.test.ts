/**
 * Both clients of the daemon socket state a deadline. The server states
 * none, so the peers it builds fall back to five seconds.
 *
 * `netron.ts:797` builds a RemotePeer for an ACCEPTED connection with
 *
 *     serverRequestTimeout ?? transportOpts.requestTimeout
 *
 * where the first is `config.options?.requestTimeout` from
 * `registerTransportServer` and the second is the client-side option store.
 * `daemon.ts:525` registers the unix server with `path`, `force` and `mode`
 * and no deadline at all, and the daemon never calls
 * `setTransportOptions('unix', …)` — so both are undefined and the peer gets
 * netron's `REQUEST_TIMEOUT`, 5000 ms (netron/constants.ts:73).
 *
 * That default is a deadline for a WIRE REQUEST. What travels this socket is
 * management-plane work between the daemon and the applications it
 * supervises, and every other party on it says so explicitly:
 *
 *     DaemonClient          60_000   (daemon-client.ts:41, CLI_REQUEST_TIMEOUT)
 *     app → daemon (unix)   60_000   (bootstrap-process.ts:126, TOPOLOGY_REQUEST_TIMEOUT)
 *     pool → worker        120_000   (orchestrator.service.ts:1918)
 *     daemon unix server         —   nothing
 *
 * The reading of the server option was ADDED deliberately — its docblock in
 * `netron.ts` says «Reading only the client store is why a `requestTimeout`
 * set on the server was silently ignored» — and then nobody set it. A fix
 * that covers one direction: the mechanism works, the value is absent.
 *
 * This does not claim to be the source of every `RPC request timed out after
 * 5000ms` left on the stand; the remaining ones are still being traced, and
 * the docblock at `bootstrap-process.ts:110` records that search. It is the
 * one place found by reading where a peer is demonstrably built without a
 * deadline.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('a server that never stated its deadline', () => {
  it("the daemon's unix server states a request deadline", () => {
    const daemon = source('../../src/daemon/daemon.ts');

    const unixServer = daemon.slice(
      daemon.indexOf("registerTransportServer('unix'"),
      daemon.indexOf("setTransportAuthContext('unix'"),
    );

    expect(unixServer, 'the accepted-connection peer falls back to netron\'s 5 s').toMatch(
      /requestTimeout/,
    );
  });

  it('and states the same one its own clients use', () => {
    // Control: a deadline that disagrees with the client's is the defect
    // this repository has already paid for twice — the shutdown ladder and
    // the topology call both had two sides computing one number.
    const daemon = source('../../src/daemon/daemon.ts');
    const client = source('../../src/daemon/daemon-client.ts');

    const clientTimeout = /CLI_REQUEST_TIMEOUT\s*=\s*([0-9_]+)/.exec(client)?.[1]?.replace(/_/g, '');
    expect(clientTimeout, 'the client stopped stating one').toBeTruthy();

    const unixServer = daemon.slice(
      daemon.indexOf("registerTransportServer('unix'"),
      daemon.indexOf("setTransportAuthContext('unix'"),
    );
    const serverTimeout = /requestTimeout:\s*([A-Z_0-9]+)/.exec(unixServer)?.[1];
    expect(serverTimeout, 'the server states a literal instead of a shared name').toBeTruthy();

    // Both sides must resolve to the same number, whatever it is called.
    const named = new RegExp(`${serverTimeout}\\s*=\\s*([0-9_]+)`).exec(daemon)?.[1]?.replace(/_/g, '');
    expect(named, `${serverTimeout} is not defined in daemon.ts`).toBe(clientTimeout);
  });
});
