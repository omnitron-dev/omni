/**
 * The maximum value that can be used for unique identifiers (UIDs) in the Netron system.
 * This value is derived from Number.MAX_SAFE_INTEGER with an unsigned right shift operation
 * to ensure it's a valid 32-bit unsigned integer. This is crucial for maintaining
 * compatibility with network protocols and binary operations.
 *
 * @constant {number} MAX_UID_VALUE
 * @see Number.MAX_SAFE_INTEGER
 */
export const MAX_UID_VALUE = Number.MAX_SAFE_INTEGER >>> 0;

/**
 * A unique Symbol used for context isolation in the Netron framework.
 * This symbol is used to mark and identify context-specific properties and methods,
 * ensuring proper isolation between different execution contexts.
 *
 * @constant {symbol} CONTEXTIFY_SYMBOL
 */
export const CONTEXTIFY_SYMBOL = Symbol();

/**
 * Event emitted when a service is exposed to the network.
 * This event is triggered when a service becomes available for remote access,
 * allowing other peers to discover and interact with it.
 *
 * @constant {string} NETRON_EVENT_SERVICE_EXPOSE
 */
export const NETRON_EVENT_SERVICE_EXPOSE = 'service:expose';

/**
 * Event emitted when a service is unexposed from the network.
 * This event indicates that a previously available service is no longer
 * accessible to remote peers.
 *
 * @constant {string} NETRON_EVENT_SERVICE_UNEXPOSE
 */
export const NETRON_EVENT_SERVICE_UNEXPOSE = 'service:unexpose';

/**
 * Event emitted when a new peer connects to the network.
 * This event is triggered when a new peer successfully establishes
 * a connection and becomes part of the Netron network.
 *
 * @constant {string} NETRON_EVENT_PEER_CONNECT
 */
export const NETRON_EVENT_PEER_CONNECT = 'peer:connect';

/**
 * Event emitted when a peer disconnects from the network.
 * This event indicates that a previously connected peer has
 * terminated its connection or become unavailable.
 *
 * @constant {string} NETRON_EVENT_PEER_DISCONNECT
 */
export const NETRON_EVENT_PEER_DISCONNECT = 'peer:disconnect';

/**
 * The maximum time (in milliseconds) allowed for establishing a connection
 * with a remote peer. If the connection is not established within this timeframe,
 * the connection attempt will be considered failed.
 *
 * @constant {number} CONNECT_TIMEOUT
 */
export const CONNECT_TIMEOUT = 5000;

/**
 * The maximum time (in milliseconds) allowed for a request to complete.
 * If a response is not received within this timeframe, the request
 * will be considered timed out and an error will be raised.
 *
 * @constant {number} REQUEST_TIMEOUT
 */
export const REQUEST_TIMEOUT = 5000;

/**
 * The maximum number of events that can be queued per event ID.
 * This prevents unbounded memory growth from potential DoS attacks
 * or misbehaving clients that continuously emit events.
 *
 * @constant {number} MAX_EVENT_QUEUE_SIZE
 */
export const MAX_EVENT_QUEUE_SIZE = 1000;

// --- Connection Management Constants ---

/**
 * Maximum connections allowed per peer.
 * Prevents any single peer from exhausting connection resources.
 *
 * @constant {number} MAX_CONNECTIONS_PER_PEER
 */
export const MAX_CONNECTIONS_PER_PEER = 10;

/**
 * Global maximum connections across all peers.
 * Protects against resource exhaustion from too many connections.
 *
 * @constant {number} MAX_TOTAL_CONNECTIONS
 */
export const MAX_TOTAL_CONNECTIONS = 100;

/**
 * Default connection pool size per peer for reuse.
 * Connections beyond this count are subject to idle cleanup.
 *
 * @constant {number} CONNECTION_POOL_SIZE
 */
export const CONNECTION_POOL_SIZE = 3;

/**
 * Idle connection timeout in milliseconds.
 * Connections inactive for this duration may be closed.
 *
 * @constant {number} IDLE_CONNECTION_TIMEOUT
 */
export const IDLE_CONNECTION_TIMEOUT = 30000;

/**
 * Health check interval in milliseconds.
 * How often to perform heartbeat checks on connections.
 *
 * @constant {number} HEALTH_CHECK_INTERVAL
 */
export const HEALTH_CHECK_INTERVAL = 15000;

/**
 * Maximum missed heartbeats before marking connection unhealthy.
 *
 * @constant {number} MAX_MISSED_HEARTBEATS
 */
export const MAX_MISSED_HEARTBEATS = 3;

/**
 * Heartbeat timeout in milliseconds.
 * If ping response not received within this time, heartbeat is missed.
 *
 * @constant {number} HEARTBEAT_TIMEOUT
 */
export const HEARTBEAT_TIMEOUT = 5000;

/**
 * Base delay for reconnection in milliseconds.
 * Used as starting point for exponential backoff.
 *
 * @constant {number} RECONNECT_BASE_DELAY
 */
export const RECONNECT_BASE_DELAY = 1000;

/**
 * Maximum delay for reconnection in milliseconds.
 * Caps the exponential backoff to prevent excessively long waits.
 *
 * @constant {number} RECONNECT_MAX_DELAY
 */
export const RECONNECT_MAX_DELAY = 30000;

/**
 * Default maximum reconnection attempts.
 * Set to 0 for unlimited attempts.
 *
 * @constant {number} RECONNECT_MAX_ATTEMPTS
 */
export const RECONNECT_MAX_ATTEMPTS = 10;

/**
 * Jitter factor for reconnection delays (0-1).
 * Adds randomness to prevent thundering herd.
 *
 * @constant {number} RECONNECT_JITTER_FACTOR
 */
export const RECONNECT_JITTER_FACTOR = 0.3;

/**
 * Cleanup interval for expired/idle connections in milliseconds.
 *
 * @constant {number} CONNECTION_CLEANUP_INTERVAL
 */
export const CONNECTION_CLEANUP_INTERVAL = 10000;
