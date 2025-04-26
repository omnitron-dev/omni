import { RemotePeer } from '../remote-peer';

/**
 * Removes a service reference from a remote peer in the Netron network.
 * This function acts as a bridge between the core task layer and the peer implementation,
 * delegating the actual service reference removal to the peer's unrefService method.
 * 
 * @param {RemotePeer} peer - The remote peer instance from which the service reference should be removed.
 *                           This peer must be connected and authenticated in the Netron network.
 * @param {string} defId - The unique identifier of the service definition to unreference.
 *                        This ID should match the one used when the service was originally referenced.
 * @returns {void} This function does not return a value as it operates through side effects.
 * 
 * @example
 * // Remove a service reference from a connected peer
 * unref_service(remotePeer, 'auth-service-123');
 * 
 * @remarks
 * This function is typically used to clean up service references when they are no longer needed.
 * It helps prevent memory leaks and ensures proper resource management in the Netron network.
 * The function assumes that the peer is properly connected and has the necessary permissions
 * to unreference services.
 */
export function unref_service(peer: RemotePeer, defId: string): void {
  peer.netron.peer.unrefService(defId);
}
