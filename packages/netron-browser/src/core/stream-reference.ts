/**
 * Stream reference for browser
 * Provides serializable stream references for the Netron browser client
 */

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
    const type = stream instanceof NetronReadableStream ? 'readable' : 'writable';
    return new StreamReference(stream.id, type, stream.isLive, stream.peer.id);
  }

  /**
   * Creates a stream instance from a StreamReference.
   * This method is used to deserialize a stream reference into a working stream instance
   * on the receiving end of a network transmission.
   *
   * @static
   * @param {StreamReference} ref - The stream reference to convert
   * @param {any} peer - The remote peer that owns the stream
   * @returns {NetronReadableStream | NetronWritableStream} A new stream instance
   */
  static to(ref: StreamReference, peer: any): NetronReadableStream | NetronWritableStream {
    if (ref.type === 'readable') {
      // For readable streams from the remote peer's perspective, we create a writable stream
      // because we'll be writing data to send to the remote peer
      let stream = peer.writableStreams.get(ref.streamId);
      if (!stream) {
        stream = new NetronWritableStream({
          peer,
          streamId: ref.streamId,
          isLive: ref.isLive,
        });
      }
      return stream;
    } else {
      // For writable streams from the remote peer's perspective, we create a readable stream
      // because we'll be reading data sent from the remote peer
      let stream = peer.readableStreams.get(ref.streamId);
      if (!stream) {
        stream = new NetronReadableStream({
          peer,
          streamId: ref.streamId,
          isLive: ref.isLive,
        });
      }
      return stream;
    }
  }
}
