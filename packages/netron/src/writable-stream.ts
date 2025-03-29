import { Readable } from 'stream';

import { Uid } from './uid';
import { RemotePeer } from './remote-peer';

const uid = new Uid();

/**
 * Represents a writable stream that can send data to a remote peer.
 */
export class WritableStream {
  public id: number; // Unique identifier for the stream
  public closed = false; // Indicates whether the stream is closed
  private index = 0; // Index of the current chunk being sent
  public expectedIndex = 0; // Index of the expected chunk

  /**
   * Constructs a WritableStream instance.
   *
   * @param peer - The remote peer to which the stream will send data.
   * @param source - An optional source of data, which can be an AsyncIterable or a Readable stream.
   * @param isLive - A boolean indicating if the stream is live. Defaults to false.
   */
  private constructor(
    private peer: RemotePeer,
    source?: AsyncIterable<any> | Readable,
    private isLive: boolean = false
  ) {
    this.id = uid.next();

    if (source) {
      this.pipeFrom(source);
    }
  }

  /**
   * Pipes data from the given source to the stream.
   *
   * @param source - The source of data, which can be an AsyncIterable or a Readable stream.
   */
  private async pipeFrom(source: AsyncIterable<any> | Readable) {
    for await (const chunk of source) {
      if (this.closed) break; // Stop if the stream is closed
      await this.write(chunk); // Write each chunk to the stream
    }
    if (!this.isLive) {
      this.end(); // End the stream if it is not live
    }
  }

  /**
   * Writes data to the stream.
   *
   * @param data - The data to write to the stream.
   * @throws Error if the stream is closed.
   */
  async write(data: any) {
    if (this.closed) throw new Error('Stream is closed');
    return this.peer.sendStreamChunk(this.id, data, this.index++, false, this.isLive);
  }

  /**
   * Ends the stream by sending a final chunk.
   */
  async end(force: boolean = false) {
    if (this.closed) return;

    if (!this.isLive || force) {
      await this.peer.sendStreamChunk(this.id, null, this.index, true, this.isLive);
      this.close();
    }
  }

  /**
   * Closes the stream and notifies the remote peer.
   */
  private close() {
    this.closed = true;
    this.peer.writableStreams.delete(this.id);
  }

  static create(peer: RemotePeer, source?: AsyncIterable<any> | Readable, isLive: boolean = false) {
    const stream = new WritableStream(peer, source, isLive);
    peer.writableStreams.set(stream.id, stream);
    return stream;
  }
}
