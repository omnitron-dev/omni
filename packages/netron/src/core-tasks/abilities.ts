import { Abilities } from '../types';
import { Definition } from '../definition';
import { RemotePeer } from '../remote-peer';

/**
 * Handles the exchange of capabilities between peers during connection establishment.
 * This function is responsible for:
 * 1. Processing and storing the remote peer's capabilities
 * 2. Building and returning the local peer's capabilities
 * 
 * @param {RemotePeer} peer - The remote peer instance requesting capabilities exchange
 * @param {Abilities} [remoteAbilities] - Optional capabilities provided by the remote peer
 * @returns {Abilities} The local peer's capabilities including available services and event support
 * 
 * @example
 * // Exchange capabilities with a connecting peer
 * const localAbilities = abilities(remotePeer, {
 *   allowServiceEvents: true,
 *   services: new Map()
 * });
 */
export function abilities(peer: RemotePeer, remoteAbilities?: Abilities) {
  // Process and store remote peer's capabilities if provided
  if (remoteAbilities) {
    // Update the remote peer's abilities with the provided capabilities
    peer.abilities = remoteAbilities;

    // If the remote peer supports service events, set up event subscription
    // Note: Currently commented out as NETRON_EVENT_SERVICE_EXPOSE is not defined
    if (remoteAbilities.allowServiceEvents) {
      // peer.subscribe(NETRON_EVENT_SERVICE_EXPOSE);
    }
  }

  // Initialize the response object with local capabilities
  const result: Abilities = {
    // Map of service definitions available on this Netron instance
    // Key: service name, Value: service definition
    services: new Map<string, Definition>(),

    // Determine if service events are enabled based on Netron configuration
    // Defaults to false if not explicitly configured
    allowServiceEvents: peer.netron.options?.allowServiceEvents ?? false,
  };

  // Populate the services map with all available services
  // Iterate through each service stub in the Netron instance
  for (const [name, stub] of peer.netron.services.entries()) {
    // Add the service definition to the capabilities map
    result.services?.set(name, stub.definition);
  }

  return result;
}
