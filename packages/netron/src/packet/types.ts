/**
 * Represents the impulse flag of a network packet, which determines whether the packet
 * is a request or a response in the request-response communication pattern.
 *
 * @typedef {number} PacketImpulse
 * @property {0} RESPONSE - Indicates that the packet is a response to a previous request
 * @property {1} REQUEST - Indicates that the packet is initiating a new request
 *
 * @example
 * // Create a request packet
 * const requestPacket = new Packet();
 * requestPacket.setImpulse(1); // Set as request
 *
 * // Create a response packet
 * const responsePacket = new Packet();
 * responsePacket.setImpulse(0); // Set as response
 */
export type PacketImpulse = 0 | 1;

/**
 * Defines the set of packet types used in the Netron network protocol.
 * Each type represents a specific operation or action that can be performed
 * through network communication.
 *
 * @constant {number} TYPE_PING - Used for connection health checks and latency measurement
 * @constant {number} TYPE_GET - Requests retrieval of a property value from a remote peer
 * @constant {number} TYPE_SET - Requests modification of a property value on a remote peer
 * @constant {number} TYPE_CALL - Initiates execution of a remote method or function
 * @constant {number} TYPE_TASK - Triggers execution of a predefined remote task
 * @constant {number} TYPE_STREAM - Indicates streaming data transmission
 * @constant {number} TYPE_STREAM_ERROR - Signals an error condition during stream transmission
 * @constant {number} TYPE_STREAM_CLOSE - Explicit stream closure notification
 *
 * @example
 * // Create a packet for property retrieval
 * const packet = new Packet();
 * packet.setType(TYPE_GET);
 */
export const TYPE_PING = 0x00;
export const TYPE_GET = 0x01;
export const TYPE_SET = 0x02;
export const TYPE_CALL = 0x03;
export const TYPE_TASK = 0x04;
export const TYPE_STREAM = 0x05;
export const TYPE_STREAM_ERROR = 0x06;
export const TYPE_STREAM_CLOSE = 0x07;

/**
 * Represents the union type of all possible packet types in the Netron protocol.
 * This type is used to ensure type safety when working with packet types throughout
 * the codebase.
 *
 * @typedef {number} PacketType
 * @property {number} TYPE_GET - Property retrieval request
 * @property {number} TYPE_SET - Property modification request
 * @property {number} TYPE_CALL - Remote method invocation
 * @property {number} TYPE_TASK - Remote task execution
 * @property {number} TYPE_STREAM - Data streaming
 * @property {number} TYPE_STREAM_ERROR - Stream error notification
 * @property {number} TYPE_STREAM_CLOSE - Stream close notification
 *
 * @example
 * function handlePacket(packet: Packet) {
 *   const type: PacketType = packet.getType();
 *   switch(type) {
 *     case TYPE_GET:
 *       // Handle property retrieval
 *       break;
 *     case TYPE_SET:
 *       // Handle property modification
 *       break;
 *   }
 * }
 */
export type PacketType =
  | typeof TYPE_GET
  | typeof TYPE_SET
  | typeof TYPE_CALL
  | typeof TYPE_TASK
  | typeof TYPE_STREAM
  | typeof TYPE_STREAM_ERROR
  | typeof TYPE_STREAM_CLOSE;

/**
 * Enumerates the possible types of packets within a data stream.
 * This enum is used to manage the flow and state of streaming data transmission.
 *
 * @enum {number}
 * @property {number} FIRST - Indicates the initial packet of a new stream
 * @property {number} MIDDLE - Represents intermediate packets in an ongoing stream
 * @property {number} LAST - Marks the final packet of a stream
 *
 * @example
 * // Handle stream packets based on their position
 * function processStreamPacket(packet: Packet) {
 *   switch(packet.streamType) {
 *     case StreamType.FIRST:
 *       // Initialize stream processing
 *       break;
 *     case StreamType.MIDDLE:
 *       // Process stream data
 *       break;
 *     case StreamType.LAST:
 *       // Finalize stream processing
 *       break;
 *   }
 * }
 */
export enum StreamType {
  FIRST = 0x01,
  MIDDLE = 0x02,
  LAST = 0x03,
}
