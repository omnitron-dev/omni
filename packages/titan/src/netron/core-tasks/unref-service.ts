import { RemotePeer } from '../remote-peer.js';

/**
 * Removes a service reference from a remote peer in the Netron network.
 * This function acts as a bridge between the core task layer and the peer implementation,
 * delegating the actual service reference removal to the peer's unrefService method.
 *
 * NOTE on security (T#36): unlike `expose_service` and `unexpose_service`, this
 * task is intentionally NOT gated. It is invoked by every well-behaved client
 * during normal interface-release lifecycle (`peer.releaseInterface(...)` →
 * `runTask('unref_service', defId)`). The underlying `LocalPeer.unrefService`
 * touches only the per-instance reference map (`serviceInstances`) and does
 * not mutate `netron.services` — so an anonymous peer cannot use it to
 * de-register a service from the public registry.
 *
 * @param {RemotePeer} peer - The remote peer instance from which the service reference should be removed.
 * @param {string} defId - The unique identifier of the service definition to unreference.
 */
export function unref_service(peer: RemotePeer, defId: string): void {
  peer.netron.peer.unrefService(defId);
}
