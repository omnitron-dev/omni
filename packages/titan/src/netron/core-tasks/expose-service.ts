import { ServiceMetadata } from '../types.js';
import { RemotePeer } from '../remote-peer.js';
import { enforceRemoteExposureAllowed } from './_guard.js';

/**
 * Exposes a service to a remote peer in the Netron network.
 * This function acts as a bridge between the core task layer and the peer implementation,
 * delegating the actual service exposure to the peer's exposeRemoteService method.
 *
 * @param {RemotePeer} peer - The remote peer instance to which the service should be exposed.
 *                           This peer must be connected and authenticated in the Netron network.
 * @param {ServiceMetadata} meta - The metadata describing the service to be exposed.
 *                                This includes information about the service's interface,
 *                                methods, properties, and other relevant configuration.
 * @returns {Promise<void>} A promise that resolves when the service has been successfully
 *                         exposed to the remote peer. The promise may reject if:
 *                         - The peer is not connected
 *                         - The service metadata is invalid
 *                         - The peer does not have permission to expose services
 *
 * @example
 * // Expose a service to a connected peer
 * const serviceMeta = {
 *   name: 'auth',
 *   version: '1.0.0',
 *   methods: ['login', 'logout'],
 *   properties: ['isAuthenticated']
 * };
 * await expose_service(remotePeer, serviceMeta);
 */
export async function expose_service(peer: RemotePeer, meta: ServiceMetadata) {
  // SECURITY (T#36): the wire-level entry point is deny-by-default.
  // Trusted local code calls `LocalPeer.exposeRemoteService()` directly
  // and bypasses this guard; remote peers must be explicitly allowed
  // via the Netron `allowRemoteServiceExposure` option.
  //
  // Marked `async` (rather than the historical synchronous `function`)
  // so that the guard's `throw` surfaces as a Promise rejection — the
  // wire-level handler awaits the task and expects rejections, not
  // thrown errors, to flow through its error response path.
  enforceRemoteExposureAllowed(peer, 'expose_service');
  return peer.netron.peer.exposeRemoteService(peer, meta);
}
