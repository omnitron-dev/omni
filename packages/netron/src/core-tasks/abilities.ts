import { Abilities } from '../types';
import { Definition } from '../definition';
import { RemotePeer } from '../remote-peer';

// This task is usually called by the connecting peer, which can optionally send its capabilities.
export function abilities(peer: RemotePeer, remoteAbilities?: Abilities) {
  if (remoteAbilities) {
    // Set the abilities of the remote peer.
    peer.abilities = remoteAbilities;

    if (remoteAbilities.allowServiceEvents) {
      // Subscribe the peer to service exposure events.
      // peer.subscribe(NETRON_EVENT_SERVICE_EXPOSE);
    }
  }

  const result: Abilities = {
    // List of services available on this netron.
    services: new Map<string, Definition>(),
    allowServiceEvents: peer.netron.options?.allowServiceEvents ?? false,
  };

  // Populate the services map with the services available on the peer's netron.
  for (const [name, stub] of peer.netron.services.entries()) {
    result.services?.set(name, stub.definition);
  }

  return result;
}
