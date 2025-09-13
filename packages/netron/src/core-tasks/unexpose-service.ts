import { RemotePeer } from '../remote-peer';

/**
 * Removes a previously exposed service from a remote peer in the Netron network.
 * This function acts as a bridge between the core task layer and the peer implementation,
 * delegating the actual service unexposure to the peer's unexposeRemoteService method.
 *
 * @param {RemotePeer} peer - The remote peer instance from which the service should be unexposed.
 *                           This peer must be connected and authenticated in the Netron network.
 * @param {string} serviceName - The name of the service to unexpose. This should match
 *                              the name used when the service was originally exposed.
 * @returns {Promise<void>} A promise that resolves when the service has been successfully
 *                         unexposed from the remote peer. The promise may reject if:
 *                         - The peer is not connected
 *                         - The service name is invalid
 *                         - The service was not previously exposed
 *                         - The peer does not have permission to unexpose services
 *
 * @example
 * // Unexpose a service from a connected peer
 * await unexpose_service(remotePeer, 'auth');
 *
 * @remarks
 * This function is the counterpart to expose_service and is used to clean up service
 * exposure when it is no longer needed. It ensures proper cleanup of resources and
 * event subscriptions associated with the exposed service.
 */
export function unexpose_service(peer: RemotePeer, serviceName: string) {
  return peer.netron.peer.unexposeRemoteService(peer, serviceName);
}
