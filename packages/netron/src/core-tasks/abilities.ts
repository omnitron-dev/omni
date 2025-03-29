import { Abilities } from '../types';
import { Definition } from '../definition';
import { RemotePeer } from '../remote-peer';

// This task is usually called by the connecting peer, which can optionally send its capabilities.
export function abilities(peer: RemotePeer, remoteAbilities?: Abilities) {
  if (remoteAbilities) {
    // Set the abilities of the remote peer.
    peer.abilities = remoteAbilities;

    if (remoteAbilities.subsribeForServices) {
      // Subscribe the peer to service exposure events.
      // peer.subscribe(NETRON_EVENT_SERVICE_EXPOSE);
    }
  }

  // TODO: Make tasks and subsribeForServices configurable at the netron level.
  const result: Abilities = {
    // List of services available on this netron.
    services: new Map<string, Definition>(),
    // List of tasks that can be executed on the current peer.
    tasks: ['abilities', 'subscribe', 'unsubscribe', 'emit', 'expose', 'unexpose'],
    ...peer.netron.options?.abilities,
  };

  // Populate the services map with the services available on the peer's netron.
  for (const [name, stub] of peer.netron.services.entries()) {
    result.services?.set(name, stub.definition);
  }

  return result;
}
