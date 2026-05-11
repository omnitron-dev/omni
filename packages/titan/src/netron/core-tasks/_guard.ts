/**
 * Shared guards for core tasks reachable over the wire.
 *
 * Why this file exists
 * --------------------
 * Three of Netron's core tasks — `expose_service`, `unexpose_service`,
 * and `unref_service` — let a remote peer mutate the LocalPeer's
 * service registry. Until T#36 they were addressable by ANY connected
 * peer (authenticated or not), with no check that the caller owned
 * the target service. That meant:
 *
 *   - Any peer could publish a service definition with arbitrary
 *     metadata, polluting the registry that `query_interface` exposes.
 *   - Any peer could unexpose ANY service, not just one it owned —
 *     letting an anonymous client tear down legitimate services
 *     hosted by other peers.
 *
 * `enforceRemoteExposureAllowed()` denies the call entirely unless the
 * Netron host opted in via `allowRemoteServiceExposure: true`. That
 * default is secure (server-to-server federation must be deliberately
 * enabled), and matches the policy the audit recommended.
 *
 * `enforceOwnership()` covers the orthogonal hardening for the
 * unexpose / unref paths: even when remote exposure IS allowed, a
 * peer must only mutate definitions whose `peerId` matches its own.
 */

import { Errors } from '../../errors/index.js';
import type { RemotePeer } from '../remote-peer.js';
import type { Definition } from '../definition.js';

export function enforceRemoteExposureAllowed(peer: RemotePeer, taskName: string): void {
  if (!peer.netron.options?.allowRemoteServiceExposure) {
    throw Errors.forbidden(
      `Core task '${taskName}' is disabled for remote peers. Set Netron option ` +
        `'allowRemoteServiceExposure: true' to allow federated peers to publish or ` +
        `withdraw services, and gate with an AuthorizationManager.`,
      { task: taskName, peerId: peer.id },
    );
  }
}

export function enforceOwnership(peer: RemotePeer, def: Definition | undefined, taskName: string): void {
  if (!def) {
    throw Errors.notFound('Service', taskName);
  }
  if (def.peerId !== peer.id) {
    throw Errors.forbidden(`Peer ${peer.id} does not own service definition ${def.id}`, {
      task: taskName,
      peerId: peer.id,
      ownerPeerId: def.peerId,
    });
  }
}
