/**
 * The node page could say a node was fine while none of its data arrived.
 *
 * Every signal on the card answered the same question — can this master
 * reach it. SSH connects, ICMP replies, the daemon answers a ping with its
 * version. A node can pass all of that and replicate nothing, and until the
 * master started dialling nodes that no stack had been deployed onto, every
 * registered node did: 47,407 entries buffered on the first one, none
 * delivered, over eleven hours, shown healthy on this page throughout.
 *
 * Reachability and membership are different questions. These pin the second
 * one, and the order in which its states are told apart.
 */

import { describe, it, expect } from 'vitest';

import { meshStanding } from '../../webapp/src/pages/nodes.js';

const mesh = (over: Partial<Parameters<typeof meshStanding>[0]> = {}): Parameters<typeof meshStanding>[0] => ({
  nodeId: 'n1',
  inMesh: true,
  status: 'connected',
  via: 'direct',
  authenticated: true,
  lastHeartbeat: null,
  lastError: null,
  ...over,
});

describe('what the card says about a node', () => {
  it('says nothing is arriving when the master is not connected', () => {
    const standing = meshStanding(mesh({ inMesh: false, status: 'disconnected' }));

    expect(standing.text).toBe('not joined');
    // The consequence, not the state. "disconnected" beside a healthy green
    // dot reads as a detail; this reads as the thing to act on.
    expect(standing.tooltip).toMatch(/replicated/i);
  });

  it('warns about a live connection that can pull nothing', () => {
    // Checked BEFORE the transport, because this is the state that looks
    // healthiest and carries least: `ping` needs no credential, so the
    // connection is up, the node answers, and every data call behind it is
    // refused.
    const standing = meshStanding(mesh({ authenticated: false }));

    expect(standing.text).toBe('unauthenticated');
    expect(standing.tone).toBe('warn');
    expect(standing.tooltip).toMatch(/replicates nothing/i);
  });

  it('says when a node is only reachable through SSH', () => {
    const standing = meshStanding(mesh({ via: 'ssh-tunnel' }));

    expect(standing.text).toBe('over SSH');
    // Working, and worth knowing before someone goes looking for the
    // latency: it means this node's daemon port is closed to this master.
    expect(standing.tooltip).toMatch(/not open to this master/i);
  });

  it('is plain about a healthy direct link', () => {
    const standing = meshStanding(mesh());

    expect(standing.text).toBe('direct');
    expect(standing.tone).toBe('good');
  });

  it('carries the reason a connection is failing', () => {
    const standing = meshStanding(mesh({ status: 'error', lastError: 'connect ETIMEDOUT 10.0.0.7:9700' }));

    expect(standing.text).toBe('failing');
    expect(standing.tooltip).toContain('ETIMEDOUT');
  });

  it('does not call a connection attempt a failure', () => {
    expect(meshStanding(mesh({ status: 'connecting' })).text).toBe('joining');
  });

  it('prefers the failure over the transport when both are true', () => {
    // A node whose SSH tunnel is failing is failing, not "over SSH".
    expect(meshStanding(mesh({ status: 'error', via: 'ssh-tunnel' })).text).toBe('failing');
  });
});
