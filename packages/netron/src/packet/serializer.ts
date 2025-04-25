import { SmartBuffer } from '@devgrid/smartbuffer';
import { Serializer, registerCommonTypesFor } from '@devgrid/messagepack';

import { Reference } from '../reference';
import { Definition } from '../definition';
import { StreamReference } from '../stream-reference';
// Create a new instance of the Serializer class, which is responsible for encoding and decoding objects.
export const serializer = new Serializer();

// Register common types for the serializer to handle, ensuring it can process standard data types.
registerCommonTypesFor(serializer);

// Register custom encoders and decoders specific to the Netron application.
// These are used to serialize and deserialize complex objects like Definition and Reference.

// Register an encoder/decoder for the Definition class with a unique type identifier 109.
serializer
  .register(
    109,
    Definition,
    // Encoder function for Definition objects.
    (obj: Definition, buf: SmartBuffer) => {
      // Write the Definition object's id and parentId as 32-bit unsigned integers to the buffer.
      serializer.encode(obj.id, buf);
      serializer.encode(obj.parentId, buf);
      // Use the serializer to encode the peerId and meta properties of the Definition object.
      serializer.encode(obj.peerId, buf);
      serializer.encode(obj.meta, buf);
    },
    // Decoder function for Definition objects.
    (buf: SmartBuffer) => {
      // Read the id and parentId from the buffer as 32-bit unsigned integers.
      const id = serializer.decode(buf);
      const parentId = serializer.decode(buf);
      // Decode the peerId and meta properties using the serializer.
      const peerId = serializer.decode(buf);
      const meta = serializer.decode(buf);
      // Create a new Definition object with the decoded values.
      const def = new Definition(id, peerId, meta);
      // Set the parentId of the Definition object.
      def.parentId = parentId;
      // Return the reconstructed Definition object.
      return def;
    }
  )
  .register(
    108,
    Reference,
    // Encoder function for Reference objects.
    (obj: any, buf: SmartBuffer) => {
      // Write the defId of the Reference object as a 32-bit unsigned integer to the buffer.
      serializer.encode(obj.defId, buf);
    },
    // Decoder function for Reference objects.
    (buf: SmartBuffer) =>
      // Create and return a new Reference object using the defId read from the buffer.
      new Reference(serializer.decode(buf))
  )
  .register(
    107,
    StreamReference,
    // Encoder function for StreamReference objects.
    (obj: any, buf: SmartBuffer) => {
      serializer.encode(obj.streamId.toString(), buf);
      buf.writeUInt8(obj.type === 'writable' ? 1 : 0);
      buf.writeUInt8(obj.isLive ? 1 : 0);
      serializer.encode(obj.peerId, buf);
    },
    // Decoder function for StreamReference objects.
    (buf: SmartBuffer) => {
      const streamId = Number(serializer.decode(buf));
      const streamType = buf.readUInt8() === 1 ? 'writable' : 'readable';
      const isLive = buf.readUInt8() === 1;
      const peerId = serializer.decode(buf);
      return new StreamReference(streamId, streamType, isLive, peerId);
    }
  );
