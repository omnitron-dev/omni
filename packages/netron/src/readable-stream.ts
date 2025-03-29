import { Packet } from './packet';
import { RemotePeer } from './remote-peer';
import { ListBuffer } from './utils/list-buffer';

/**
 * Represents a readable stream that receives data chunks from a remote peer.
 */
export class ReadableStream {
  private queue = new ListBuffer<any>(); // ListBuffer is used to store incoming data chunks
  private resolvers = new ListBuffer<(value: any) => void>(); // List of promise resolvers waiting for data
  private closed = false; // Flag indicating whether the stream is closed
  public timeout?: NodeJS.Timeout; // Timeout for the stream
  private buffer = new Map<number, any>();
  private expectedIndex = 0;
  public isComplete = false;

  /**
   * Constructs a new ReadableStream instance.
   * @param peer - The remote peer from which data is received.
   * @param streamId - The unique identifier for the stream.
   * @param isLive - Indicates if the stream is live (default is false).
   */
  constructor(
    private peer: RemotePeer,
    public id: number,
    public isLive = false
  ) {
    if (!isLive) {
      this.timeout = setTimeout(() => {
        console.warn(`Stream is inactive, deleting: ${this.id}`);
        this.onEnd();
      }, this.peer.netron.options?.streamTimeout ?? 60000);
    }
  }

  onPacket(packet: Packet) {
    if (!this.isLive && this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = setTimeout(() => {
        console.warn(`Stream is inactive, deleting: ${this.id}`);
        this.onEnd();
      }, 60000);
    }

    this.buffer.set(packet.streamIndex!, packet.data);

    // Send data to callback if chunks are in order
    while (this.buffer.has(this.expectedIndex)) {
      const chunk = this.buffer.get(this.expectedIndex);
      this.buffer.delete(this.expectedIndex);
      this.expectedIndex++;
      this.enqueue(chunk);
    }

    // If this was the last chunk, end the stream
    if (packet.isLastChunk()) {
      this.isComplete = true;
      this.onEnd();
    }
  }

  /**
   * Ends a stream.
   * @param {number} streamId - The ID of the stream to end.
   */
  private onEnd(force = false) {
    if (this.isLive && !force) {
      console.warn(`Attempt to delete live stream, but it is active: ${this.id}`);
      return;
    }

    if (this.timeout) clearTimeout(this.timeout);
    this.isComplete = true;
    this.peer.readableStreams.delete(this.id);
  }

  /**
   * Reads a data chunk from the stream.
   * @returns A promise that resolves to the next data chunk or null if the stream is closed.
   */
  async read(): Promise<any> {
    // First, process all pending read() requests
    while (this.resolvers.length > 0 && this.queue.length > 0) {
      const resolve = this.resolvers.shift();
      resolve?.(this.queue.shift());
    }

    // If there is data in the queue, return it immediately
    if (this.resolvers.length === 0 && this.queue.length > 0) {
      return this.queue.shift();
    }

    // If the stream is closed and no more data is available, return null
    if (this.closed) {
      this.flush();
      return null;
    }

    // If no data is available, wait for a new chunk
    return new Promise((resolve) => this.resolvers.push(resolve));
  }

  /**
   * Closes the stream, preventing further data from being enqueued.
   */
  public close() {
    this.closed = true;
    this.flush();
  }

  /**
   * Enqueues a data chunk into the stream's queue.
   * @param chunk - The data chunk to be enqueued.
   */
  private enqueue(chunk: any) {
    if (this.closed) return; // Do not enqueue data if the stream is closed

    if (this.queue.length > 0) {
      this.queue.push(chunk); // If the queue already has chunks, add to the end
      return;
    }

    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift();
      resolve?.(chunk); // If there are waiting resolvers, immediately resolve with the chunk
    } else {
      this.queue.push(chunk); // If no resolvers are waiting, add the chunk to the queue
    }
  }

  /**
   * Flushes the queue and resolves all pending promises with the remaining data or null.
   */
  private flush() {
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift();
      resolve?.(this.queue.length > 0 ? this.queue.shift() : null);
    }
    this.queue.clear();
  }

  static create(peer: RemotePeer, streamId: number, isLive: boolean = false) {
    const stream = new ReadableStream(peer, streamId, isLive);
    peer.readableStreams.set(stream.id, stream);
    return stream;
  }
}
