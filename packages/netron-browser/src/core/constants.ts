/**
 * The maximum value usable for unique identifiers (UIDs) in the Netron system.
 *
 * SHARED-PROTO: re-exported from @omnitron-dev/netron-protocol (single source of
 * truth shared with the titan server) so existing `./core/constants.js`
 * importers of `MAX_UID_VALUE` are unaffected and the value can't drift.
 *
 * @see Number.MAX_SAFE_INTEGER
 */
export { MAX_UID_VALUE } from '@omnitron-dev/netron-protocol';

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
