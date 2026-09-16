/**
 * `status: 'connected'` is a cached belief, and the deployer invalidates it.
 *
 * Deploying a stack to a node does two things in order: the deployer installs
 * and RESTARTS that node's daemon, waits for it to answer, and then the master
 * provisions its infrastructure over the mesh. The mesh connection it uses was
 * established to the process that just exited.
 *
 * `SlaveConnector.connections` carries a `status` field refreshed by the
 * heartbeat, so between the peer dying and the next heartbeat there is a
 * window where `waitUntilConnected` returns true for a dead socket — and
 * `addSlave` returns early on an existing key, so nothing reconnects. The only
 * way to learn the socket is gone is to use it.
 *
 * Measured on the test node, three attempts in a row: `Slave node
 * provisioned`, then `Socket closed during RPC` in the same second, then
 * `Node infrastructure is not ready`. The node was healthy throughout; the
 * connection was not.
 */

import { describe, it, expect } from 'vitest';

import { isConnectionGone } from '../../src/cluster/slave-connector.js';

describe('a closed socket is not a failed call', () => {
  it('recognises the shapes a dead connection actually produces', () => {
    // Every one of these was observed in this fleet's logs.
    for (const m of [
      'Socket closed during RPC',
      'Slave 37.27.130.185:9700 not connected',
      'write EPIPE',
      'read ECONNRESET',
      'Socket is not open',
      'connection closed',
    ]) {
      expect(isConnectionGone(new Error(m)), m).toBe(true);
    }
  });

  it('does not treat a remote refusal as a connection problem', () => {
    // A method that threw is a RESULT — reconnecting and calling it again
    // gets the same refusal, and turns one clear failure into two.
    for (const m of [
      'Missing required role',
      'Method provisionStack not found on service OmnitronInfra',
      'config payload is 4096 KB, over the 2048 KB limit',
      'No such node',
      'Validation failed: nodeId is required',
    ]) {
      expect(isConnectionGone(new Error(m)), m).toBe(false);
    }
  });

  it('handles a non-Error thrown value', () => {
    expect(isConnectionGone('Socket closed during RPC')).toBe(true);
    expect(isConnectionGone(null)).toBe(false);
    expect(isConnectionGone(undefined)).toBe(false);
  });
});
