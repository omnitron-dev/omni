import { SmartBuffer } from '@devgrid/smartbuffer';
import { Serializer, registerCommonTypesFor } from '@devgrid/messagepack';

import { Reference } from '../reference';
import { Definition } from '../definition';
import { StreamReference } from '../stream-reference';

/**
 * Global serializer instance for the Netron application.
 * This serializer is responsible for converting complex objects into binary format
 * and vice versa, enabling efficient network transmission and storage.
 *
 * @type {Serializer}
 * @constant
 */
export const serializer = new Serializer();

/**
 * Registers common data types with the serializer.
 * This enables the serializer to handle standard JavaScript types like
 * numbers, strings, arrays, and objects without additional configuration.
 */
registerCommonTypesFor(serializer);

/**
 * Registers custom serialization handlers for Netron-specific types.
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
      serializer.encode(obj.id, buf);
      serializer.encode(obj.parentId, buf);
      serializer.encode(obj.peerId, buf);
      serializer.encode(obj.meta, buf);
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
      serializer.encode(obj.defId, buf);
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
   * @param {StreamReference} - The class constructor for StreamReference objects
   * @param {Function} - Encoder function that writes StreamReference properties to buffer
   * @param {Function} - Decoder function that reconstructs StreamReference from buffer
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
