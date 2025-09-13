/**
 * Represents information about a network node in the service discovery system.
 * This interface encapsulates all essential metadata required to identify and connect to a node.
 *
 * @interface NodeInfo
 * @property {string} nodeId - Unique identifier of the node within the network
 * @property {string} address - Network address where the node can be reached (e.g., "host:port")
 * @property {ServiceInfo[]} services - Array of services available on this node
 * @property {number} timestamp - Unix timestamp indicating when this node information was last updated
 */
export interface NodeInfo {
  nodeId: string;
  address: string;
  services: ServiceInfo[];
  timestamp: number;
}

/**
 * Describes a service available in the network.
 * This interface provides the basic identification information for a service.
 *
 * @interface ServiceInfo
 * @property {string} name - Unique name of the service
 * @property {string} [version] - Optional version identifier of the service
 */
export interface ServiceInfo {
  name: string;
  version?: string;
}

/**
 * Configuration options for the service discovery mechanism.
 * These parameters control the behavior of the heartbeat system and event propagation
 * within the distributed service discovery system.
 *
 * @interface DiscoveryOptions
 * @property {number} [heartbeatInterval] - Time interval in milliseconds between consecutive heartbeat messages.
 *                                         This determines how frequently a node announces its presence to the network.
 *                                         Lower values increase network traffic but improve failure detection speed.
 * @property {number} [heartbeatTTL] - Time-to-live in milliseconds for heartbeat records in the discovery system.
 *                                    This defines how long a node's heartbeat remains valid before being considered stale.
 *                                    Should be greater than heartbeatInterval to allow for network delays.
 * @property {boolean} [pubSubEnabled] - Enables or disables Redis Pub/Sub event broadcasting functionality.
 *                                      When enabled, the system will publish node registration, update, and
 *                                      deregistration events to subscribed clients.
 * @property {string} [pubSubChannel] - Redis Pub/Sub channel name for service discovery events.
 *                                     Defaults to 'netron:discovery:events' if not specified.
 *                                     All nodes in the network should use the same channel for proper event propagation.
 */
export interface DiscoveryOptions {
  heartbeatInterval?: number;
  heartbeatTTL?: number;
  pubSubEnabled?: boolean;
  pubSubChannel?: string;
  clientMode?: boolean;
}
/**
 * Represents an event that occurs within the service discovery system.
 * This interface defines the structure of events that are published when nodes
 * register, update their status, or deregister from the network.
 *
 * @interface DiscoveryEvent
 * @property {'NODE_REGISTERED' | 'NODE_UPDATED' | 'NODE_DEREGISTERED'} type - The type of discovery event.
 *                                                                           NODE_REGISTERED: A new node has joined the network.
 *                                                                           NODE_UPDATED: An existing node has updated its information.
 *                                                                           NODE_DEREGISTERED: A node has left the network.
 * @property {string} nodeId - The unique identifier of the node associated with this event.
 * @property {string} address - The network address where the node can be reached (e.g., "host:port").
 * @property {ServiceInfo[]} services - An array of services that are available on the node at the time of the event.
 * @property {number} timestamp - Unix timestamp indicating when this event occurred.
 *                               Used for event ordering and determining event freshness.
 */
export interface DiscoveryEvent {
  type: 'NODE_REGISTERED' | 'NODE_UPDATED' | 'NODE_DEREGISTERED';
  nodeId: string;
  address: string;
  services: ServiceInfo[];
  timestamp: number;
}
