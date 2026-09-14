/**
 * One knob published four surfaces, and three of them were not the fleet.
 *
 * `daemon.host` is the bind address for the TCP fleet transport, and a fleet
 * node must publish that: a master reaches its slaves there, and a generated
 * slave config therefore sets `0.0.0.0`. The same value was also the bind for
 * the Netron HTTP RPC (`httpPort + 1`) and the WebSocket (`httpPort + 2`).
 *
 * Measured on the running daemon, which binds loopback:
 *
 *   9700: 127.0.0.1   fleet TCP    — authenticated, except `ping`
 *   9801: 127.0.0.1   HTTP RPC     — authenticated, rate-limited
 *   9802: 127.0.0.1   WebSocket    — authenticated, NOT rate-limited
 *   9803: 127.0.0.1   metrics      — loopback by its own default (T#65)
 *
 * Publish `daemon.host` and the first three go with it. On a master that is
 * the operator's choice and the console is the reason. On a slave there is no
 * console — the operator uses the master's — so what a slave gained was an
 * authentication endpoint nothing dials and a WebSocket one that, by the
 * daemon's own note, has no rate-limit option available to it.
 *
 * The fleet port stays published, and that asymmetry is the point: rebinding
 * it would take a cluster down, because being reachable is that port's whole
 * job. Rebinding these costs a slave nothing.
 */

import { describe, it, expect } from 'vitest';

import { consoleBindHostFor, resolveBindHost, isLoopbackHost } from '../../src/daemon/daemon.js';

describe('where the console surfaces bind', () => {
  it('keeps a slave on loopback however its fleet port is published', () => {
    for (const host of ['0.0.0.0', '::', '192.0.2.10', 'omnitron.example.com']) {
      expect(consoleBindHostFor({ role: 'slave', host }), host).toBe('127.0.0.1');
    }
  });

  it('leaves a master following its configuration', () => {
    // The console is the reason the knob exists, and a master is where the
    // console lives. Rebinding here would be a different bug.
    expect(consoleBindHostFor({ role: 'master', host: '0.0.0.0' })).toBe('0.0.0.0');
    expect(consoleBindHostFor({ role: 'master', host: '192.0.2.10' })).toBe('192.0.2.10');
  });

  it('defaults to loopback when no role and no host are set', () => {
    expect(consoleBindHostFor({})).toBe('127.0.0.1');
    expect(isLoopbackHost(consoleBindHostFor({}))).toBe(true);
  });

  it('does not change what the fleet transport does', () => {
    // Pinned so a later reading of this file cannot conclude the slave's
    // fleet port was rebound too. It must not be: a slave the master cannot
    // reach is an outage, not a hardening.
    expect(resolveBindHost('0.0.0.0')).toBe('0.0.0.0');
    expect(isLoopbackHost(resolveBindHost('0.0.0.0'))).toBe(false);
  });
});
