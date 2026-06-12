import { RemotePeer } from '../remote-peer.js';

/**
 * Removes a service reference from a remote peer in the Netron network.
 * This function acts as a bridge between the core task layer and the peer implementation,
 * delegating the actual service reference removal to the peer's unrefService method.
 *
 * NOTE on security (T#36 + SEC-5): unlike `expose_service` / `unexpose_service`
 * this task is intentionally NOT gated — every well-behaved client invokes it
 * during the normal interface-release lifecycle (`peer.releaseInterface(...)` →
 * `runTask('unref_service', defId)`). It never mutates the public
 * `netron.services` registry, so it cannot de-register an exposed service.
 *
 * SEC-5: it CAN, however, touch DYNAMIC sub-service stubs (those returned by
 * method calls and deduped into one shared stub per instance). To stop a
 * malicious peer A from evicting a shared dynamic stub that peer B still uses,
 * the calling peer's id is threaded through: `LocalPeer.unrefService` releases
 * only THIS peer's reference and evicts the stub only when no peer references
 * it (and a peer cannot unref a defId it never referenced).
 *
 * @param {RemotePeer} peer - The remote peer instance from which the service reference should be removed.
 * @param {string} defId - The unique identifier of the service definition to unreference.
 */
export function unref_service(peer: RemotePeer, defId: string): void {
  peer.netron.peer.unrefService(defId, peer.id);
}
