import { RemotePeer } from './remote-peer.js';
import { NetronReadableStream } from './readable-stream.js';
import { NetronWritableStream } from './writable-stream.js';

/**
 * Represents the type of stream that can be referenced.
 * This type is used to distinguish between readable and writable streams
 * in the Netron distributed system.
 *
 * @typedef {('readable' | 'writable')} StreamReferenceType
 */
export type StreamReferenceType = 'readable' | 'writable';

/**
 * StreamReference is a serializable representation of a stream in the Netron system.
 * This class serves as a bridge between local stream instances and their remote
 * representations, enabling stream data to be transmitted across the network.
 *
 * @class StreamReference
 * @property {number} streamId - Unique identifier of the stream
 * @property {StreamReferenceType} type - Type of the stream (readable or writable)
 * @property {boolean} isLive - Indicates if the stream is live/real-time
 * @property {string} peerId - ID of the peer that owns the stream
 */
export class StreamReference {
  /**
   * Creates a new StreamReference instance.
   *
   * @param {number} streamId - Unique identifier of the stream
   * @param {StreamReferenceType} type - Type of the stream (readable or writable)
   * @param {boolean} isLive - Indicates if the stream is live/real-time
   * @param {string} peerId - ID of the peer that owns the stream
   */
  constructor(
    public readonly streamId: number,
    public readonly type: StreamReferenceType,
    public readonly isLive: boolean,
    public readonly peerId: string
  ) {}

  /**
   * Creates a StreamReference from an existing stream instance.
   * This method is used to serialize a local stream for transmission over the network.
   *
   * @static
   * @param {NetronReadableStream | NetronWritableStream} stream - The stream instance to reference
   * @returns {StreamReference} A new StreamReference representing the given stream
   */
  static from(stream: NetronReadableStream | NetronWritableStream): StreamReference {
    return new StreamReference(
      stream.id,
      stream instanceof NetronWritableStream ? 'writable' : 'readable',
      stream.isLive,
      stream.peer.id
    );
  }

  /**
   * Creates a stream instance from a StreamReference.
   * This method is used to deserialize a stream reference into a working stream instance
   * on the receiving end of a network transmission.
   *
   * @static
   * @param {StreamReference} ref - The stream reference to convert
   * @param {RemotePeer} peer - The remote peer that owns the stream
   * @returns {NetronReadableStream | NetronWritableStream} A new stream instance
   * @throws {Error} If the stream type is invalid or creation fails
   */
  static to(ref: StreamReference, peer: RemotePeer): NetronReadableStream | NetronWritableStream {
    if (ref.type === 'writable') {
      return NetronReadableStream.create(peer, ref.streamId, ref.isLive);
    } else {
      return NetronWritableStream.create(peer, undefined, ref.isLive, ref.streamId);
    }
  }
}
