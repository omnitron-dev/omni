/**
 * Represents the impulse of a packet, indicating whether it is a request or a response.
 * 0 - Response
 * 1 - Request
 */
export type PacketImpulse = 0 | 1;

/**
 * Packet type constants used to define the action or purpose of a packet.
 * Each constant is represented by a unique hexadecimal value.
 */
export const TYPE_PING = 0x00; // Ping operation to check connectivity
export const TYPE_GET = 0x01; // Request to get the value of a property
export const TYPE_SET = 0x02; // Request to set the value of a property
export const TYPE_CALL = 0x03; // Request to call a method
export const TYPE_TASK = 0x04; // Request to execute a remote task
export const TYPE_STREAM = 0x05; // Transmission of streaming data
export const TYPE_STREAM_ERROR = 0x06; // Error during stream transmission

/**
 * Union type representing all possible packet types.
 * It includes types for getting, setting, calling, task execution, and streaming.
 */
export type PacketType = typeof TYPE_GET | typeof TYPE_SET | typeof TYPE_CALL | typeof TYPE_TASK | typeof TYPE_STREAM | typeof TYPE_STREAM_ERROR;

/**
 * Union type representing all possible stream types.
 * It includes types for the first, middle, and last packets in a stream.
 */
export enum StreamType {
  FIRST = 0x01,
  MIDDLE = 0x02,
  LAST = 0x03,
}
