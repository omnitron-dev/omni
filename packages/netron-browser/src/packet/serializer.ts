import { SmartBuffer } from '@omnitron-dev/smartbuffer';
import { Serializer, registerCommonTypesFor } from '@omnitron-dev/messagepack';

import { Reference } from '../core/reference.js';
import { Definition } from '../core/definition.js';
import { StreamReference } from '../core/stream-reference.js';
import { TitanError } from '../errors/core.js';

/**
 * Global serializer instance for the Netron browser client.
 * This serializer is responsible for converting complex objects into binary format
 * and vice versa, enabling efficient network transmission and storage.
 *
 * @type {Serializer}
 * @constant
 */
export const serializer = new Serializer();

/**
 * Register TitanError BEFORE common types to ensure it takes precedence over generic Error.
 * This is critical because TitanError extends Error, and we need the more specific handler
 * to be checked first.
 */
serializer.register(
  110,
  TitanError,
  /**
   * Encodes a TitanError object into a binary buffer.
   * Serializes all error properties including code, message, details, context,
   * and tracing information.
   *
   * @param {TitanError} obj - The TitanError object to encode
   * @param {SmartBuffer} buf - The buffer to write the encoded data to
   */
  (obj: TitanError, buf: SmartBuffer) => {
    // Encode core error properties
    buf.write(serializer.encode(obj.name));
    buf.write(serializer.encode(obj.code));
    buf.write(serializer.encode(obj.message));
    buf.write(serializer.encode(obj.details));
    buf.write(serializer.encode(obj.context));
    buf.write(serializer.encode(obj.timestamp));

    // Encode tracing properties
    buf.write(serializer.encode(obj.requestId));
    buf.write(serializer.encode(obj.correlationId));
    buf.write(serializer.encode(obj.spanId));
    buf.write(serializer.encode(obj.traceId));

    // Encode stack trace (optional)
    buf.write(serializer.encode(obj.stack || null));

    // Encode cause chain - serialize as plain error info to avoid deep nesting
    if ((obj as any).cause) {
      const cause = (obj as any).cause;
      if (cause instanceof TitanError) {
        // Recursively encode TitanError causes
        buf.write(serializer.encode(cause));
      } else if (cause instanceof Error) {
        // Encode plain Error as simplified object
        buf.write(
          serializer.encode({
            __errorType: 'Error',
            name: cause.name,
            message: cause.message,
            stack: cause.stack
          })
        );
      } else {
        // Unknown cause type
        buf.write(serializer.encode(null));
      }
    } else {
      buf.write(serializer.encode(null));
    }
  },
  /**
   * Decodes a TitanError object from a binary buffer.
   * Reconstructs the error with all properties.
   *
   * @param {SmartBuffer} buf - The buffer containing the encoded TitanError
   * @returns {TitanError} A new TitanError instance with restored properties
   */
  (buf: SmartBuffer) => {
    // Decode core properties
    const name = serializer.decode(buf);
    const code = serializer.decode(buf);
    const message = serializer.decode(buf);
    const details = serializer.decode(buf);
    const context = serializer.decode(buf);
    const timestamp = serializer.decode(buf);

    // Decode tracing properties
    const requestId = serializer.decode(buf);
    const correlationId = serializer.decode(buf);
    const spanId = serializer.decode(buf);
    const traceId = serializer.decode(buf);

    // Decode stack trace
    const stack = serializer.decode(buf);

    // Decode cause
    const causeData = serializer.decode(buf);
    let cause: Error | undefined;

    if (causeData) {
      if (causeData instanceof TitanError) {
        cause = causeData;
      } else if (causeData.__errorType === 'Error') {
        // Reconstruct plain Error
        const plainError = new Error(causeData.message);
        plainError.name = causeData.name;
        plainError.stack = causeData.stack;
        cause = plainError;
      }
    }

    // Create the error instance
    const error = new TitanError({
      code,
      message,
      details,
      context,
      requestId,
      correlationId,
      spanId,
      traceId,
      cause
    });

    // Restore the error name (for subclass identification)
    error.name = name;

    // Restore stack trace if present
    if (stack) {
      error.stack = stack;
    }

    // Override timestamp with the original value
    (error as any).timestamp = timestamp;

    return error;
  }
);

/**
 * Registers common data types with the serializer.
 * This enables the serializer to handle standard JavaScript types like
 * numbers, strings, arrays, and objects without additional configuration.
 * NOTE: This is called AFTER TitanError registration to ensure TitanError
 * takes precedence over the generic Error handler.
 */
registerCommonTypesFor(serializer);

/**
 * Registers additional Netron-specific types after common types.
 * Each type is assigned a unique identifier and provided with custom
 * encoding and decoding functions to handle its specific serialization needs.
 */
serializer
  /**
   * Registers serialization handlers for the Definition class.
   * Definition objects represent service definitions in the Netron network
   * and contain metadata about available services.
   *
   * @param {number} 109 - Unique type identifier for Definition objects
   * @param {Definition} - The class constructor for Definition objects
   * @param {Function} - Encoder function that writes Definition properties to buffer
   * @param {Function} - Decoder function that reconstructs Definition from buffer
   */
  .register(
    109,
    Definition,
    /**
     * Encodes a Definition object into a binary buffer.
     * The encoding process preserves the object's identity and relationships
     * by serializing its id, parentId, peerId, and metadata.
     *
     * @param {Definition} obj - The Definition object to encode
     * @param {SmartBuffer} buf - The buffer to write the encoded data to
     */
    (obj: Definition, buf: SmartBuffer) => {
      buf.write(serializer.encode(obj.id));
      buf.write(serializer.encode(obj.parentId));
      buf.write(serializer.encode(obj.peerId));
      buf.write(serializer.encode(obj.meta));
    },
    /**
     * Decodes a Definition object from a binary buffer.
     * Reconstructs the object's state by reading its properties in the same
     * order they were written during encoding.
     *
     * @param {SmartBuffer} buf - The buffer containing the encoded Definition
     * @returns {Definition} A new Definition instance with restored properties
     */
    (buf: SmartBuffer) => {
      const id = serializer.decode(buf);
      const parentId = serializer.decode(buf);
      const peerId = serializer.decode(buf);
      const meta = serializer.decode(buf);
      const def = new Definition(id, peerId, meta);
      def.parentId = parentId;
      return def;
    }
  )
  /**
   * Registers serialization handlers for the Reference class.
   * Reference objects represent service references in the Netron network,
   * linking to specific service definitions.
   *
   * @param {number} 108 - Unique type identifier for Reference objects
   * @param {Reference} - The class constructor for Reference objects
   * @param {Function} - Encoder function that writes Reference properties to buffer
   * @param {Function} - Decoder function that reconstructs Reference from buffer
   */
  .register(
    108,
    Reference,
    /**
     * Encodes a Reference object into a binary buffer.
     * Only the defId property is serialized as it uniquely identifies
     * the referenced service definition.
     *
     * @param {Reference} obj - The Reference object to encode
     * @param {SmartBuffer} buf - The buffer to write the encoded data to
     */
    (obj: any, buf: SmartBuffer) => {
      buf.write(serializer.encode(obj.defId));
    },
    /**
     * Decodes a Reference object from a binary buffer.
     * Creates a new Reference instance using the decoded defId.
     *
     * @param {SmartBuffer} buf - The buffer containing the encoded Reference
     * @returns {Reference} A new Reference instance with the restored defId
     */
    (buf: SmartBuffer) => new Reference(serializer.decode(buf))
  )
  /**
   * Registers serialization handlers for the StreamReference class.
   * StreamReference objects represent stream connections in the Netron network,
   * containing information about stream type, direction, and associated peer.
   *
   * @param {number} 107 - Unique type identifier for StreamReference objects
   */
  .register(
    107,
    StreamReference,
    /**
     * Encodes a StreamReference object into a binary buffer.
     * Serializes the stream's identity, type, liveness status, and associated peer.
     *
     * @param {StreamReference} obj - The StreamReference object to encode
     * @param {SmartBuffer} buf - The buffer to write the encoded data to
     */
    (obj: any, buf: SmartBuffer) => {
      serializer.encode(obj.streamId.toString(), buf);
      buf.writeUInt8(obj.type === 'writable' ? 1 : 0);
      buf.writeUInt8(obj.isLive ? 1 : 0);
      serializer.encode(obj.peerId, buf);
    },
    /**
     * Decodes a StreamReference object from a binary buffer.
     * Reconstructs the stream reference with its type, liveness status,
     * and associated peer information.
     *
     * @param {SmartBuffer} buf - The buffer containing the encoded StreamReference
     * @returns {StreamReference} A new StreamReference instance with restored properties
     */
    (buf: SmartBuffer) => {
      const streamId = Number(serializer.decode(buf));
      const streamType = buf.readUInt8() === 1 ? 'writable' : 'readable';
      const isLive = buf.readUInt8() === 1;
      const peerId = serializer.decode(buf);
      return new StreamReference(streamId, streamType, isLive, peerId);
    }
  );
