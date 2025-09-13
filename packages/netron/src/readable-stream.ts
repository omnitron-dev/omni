import { Readable, ReadableOptions } from 'stream';

import { Packet } from './packet';
import { RemotePeer } from './remote-peer';

/**
 * Maximum number of packets that can be buffered in the stream before
 * triggering a buffer overflow error. This limit helps prevent memory
 * exhaustion in high-throughput scenarios.
 */
const MAX_BUFFER_SIZE = 10_000;

/**
 * Configuration options for creating a new NetronReadableStream instance.
 * Extends the standard Node.js Readable stream options with Netron-specific
 * parameters required for peer-to-peer communication.
 *
 * @interface NetronReadableStreamOptions
 * @extends ReadableOptions
 * @property {RemotePeer} peer - The remote peer this stream is associated with
 * @property {number} streamId - Unique identifier for this stream
 * @property {boolean} [isLive=false] - Whether this is a live streaming connection
 */
export interface NetronReadableStreamOptions extends ReadableOptions {
  peer: RemotePeer;
  streamId: number;
  isLive?: boolean;
}

/**
 * A specialized Readable stream implementation for the Netron distributed system.
 * This class handles the reception and ordered delivery of data packets from
 * remote peers, implementing sophisticated buffering and flow control mechanisms.
 *
 * @class NetronReadableStream
 * @extends Readable
 * @description Implements a reliable, ordered data stream for peer-to-peer communication
 */
export class NetronReadableStream extends Readable {
  /** The remote peer this stream is associated with */
  public readonly peer: RemotePeer;

  /** Internal buffer for storing out-of-order packets */
  private buffer: Map<number, any> = new Map();

  /** Next expected packet index for ordered delivery */
  private expectedIndex: number = 0;

  /** Timeout handle for stream inactivity detection */
  private timeout?: NodeJS.Timeout;

  /** Unique identifier for this stream */
  public readonly id: number;

  /** Whether the stream has been closed */
  private isClosed: boolean = false;

  /** Whether all data has been successfully received */
  public isComplete: boolean = false;

  /** Whether this is a live streaming connection */
  public isLive: boolean;

  /**
   * Creates a new NetronReadableStream instance.
   *
   * @param {NetronReadableStreamOptions} options - Configuration options for the stream
   * @throws {Error} If stream initialization fails
   */
  constructor({ peer, streamId, isLive = false, ...opts }: NetronReadableStreamOptions) {
    super({ ...opts, objectMode: true });

    this.peer = peer;
    this.id = streamId;
    this.isLive = isLive;

    this.peer.logger.info({ streamId: this.id, isLive }, 'Creating readable stream');
    this.peer.readableStreams.set(this.id, this);

    if (!this.isLive) {
      this.resetTimeout();
    }

    this.on('close', this.cleanup);
    this.on('error', this.handleError);
  }

  /**
   * Processes incoming data packets and manages ordered delivery.
   * This method implements the core packet handling logic, including:
   * - Buffer overflow protection
   * - Packet reordering
   * - Flow control
   * - Stream completion detection
   *
   * @param {Packet} packet - The incoming data packet
   * @returns {void}
   * @throws {Error} If buffer overflow occurs or stream is closed
   */
  public onPacket(packet: Packet): void {
    if (this.isClosed) {
      this.peer.logger.warn({ streamId: this.id }, 'Received packet for closed stream');
      return;
    }

    this.resetTimeout();

    if (this.buffer.size > MAX_BUFFER_SIZE) {
      this.peer.logger.error({ streamId: this.id, size: this.buffer.size }, 'Stream buffer overflow');
      this.destroy(new Error(`Buffer overflow: more than ${MAX_BUFFER_SIZE} packets buffered`));
      return;
    }

    this.peer.logger.debug({ streamId: this.id, index: packet.streamIndex }, 'Processing packet');

    // Don't buffer the last packet's data if it's null
    if (!packet.isLastChunk() || packet.data !== null) {
      this.buffer.set(packet.streamIndex!, packet.data);
    }

    while (this.buffer.has(this.expectedIndex)) {
      const chunk = this.buffer.get(this.expectedIndex);
      this.buffer.delete(this.expectedIndex);
      this.expectedIndex++;

      if (!this.push(chunk)) {
        this.peer.logger.debug({ streamId: this.id }, 'Stream backpressure detected');
        break;
      }
    }

    if (packet.isLastChunk()) {
      this.peer.logger.info({ streamId: this.id }, 'Received last chunk');
      this.isComplete = true;

      // Push null to signal end of stream (Node.js convention)
      this.push(null);
      // Don't close immediately - let the stream finish naturally
    }
  }

  /**
   * Implementation of the Readable stream's _read method.
   * This method is called when the stream's internal buffer is ready to accept more data.
   * In our implementation, data is pushed in onPacket, so this method is intentionally empty.
   *
   * @returns {void}
   */
  override _read(): void {
    // Data is pushed in onPacket, no action needed here
  }

  /**
   * Resets the stream's inactivity timeout.
   * This method implements automatic stream cleanup for non-live streams
   * that have been inactive for too long.
   *
   * @returns {void}
   */
  private resetTimeout(): void {
    if (this.isLive) return;

    if (this.timeout) clearTimeout(this.timeout);

    const timeoutDuration = this.peer.netron.options?.streamTimeout ?? 60000;
    this.peer.logger.debug({ streamId: this.id, timeoutDuration }, 'Resetting stream timeout');

    this.timeout = setTimeout(() => {
      const message = `Stream ${this.id} inactive for ${timeoutDuration}ms, closing.`;
      this.peer.logger.warn(message);
      this.destroy(new Error(message));
    }, timeoutDuration);
  }

  /**
   * Closes the stream and releases associated resources.
   * This method implements graceful stream termination with support for
   * both normal and forced closure scenarios.
   *
   * @param {boolean} [force=false] - Whether to force stream closure
   * @returns {void}
   */
  public closeStream(force: boolean = false): void {
    if (this.isClosed) {
      this.peer.logger.warn({ streamId: this.id }, 'Attempt to close already closed stream');
      return;
    }

    if (this.isLive && !force) {
      this.peer.logger.warn({ streamId: this.id }, 'Attempt to close live stream');
      return;
    }

    this.peer.logger.info({ streamId: this.id, force }, 'Closing stream');
    this.push(null);

    if (this.isLive && force) {
      this.destroy();
    }
  }

  /**
   * Performs cleanup operations when the stream is closed.
   * This method ensures proper resource deallocation and stream deregistration.
   *
   * @returns {void}
   */
  private cleanup = (): void => {
    this.peer.logger.debug({ streamId: this.id }, 'Cleaning up stream resources');
    if (this.timeout) clearTimeout(this.timeout);
    this.peer.readableStreams.delete(this.id);
    this.buffer.clear();
  };

  /**
   * Handles stream error events.
   * This method implements error logging and cleanup for stream errors.
   *
   * @param {Error} error - The error that occurred
   * @returns {void}
   */
  private handleError = (error: Error): void => {
    this.peer.logger.error({ streamId: this.id, error }, 'Stream error occurred');
    this.cleanup();
  };

  /**
   * Overrides the standard destroy method to ensure proper cleanup.
   * This method implements a robust stream termination process that
   * guarantees resource cleanup and error propagation.
   *
   * @param {Error} [error] - Optional error to propagate
   * @returns {this}
   */
  public override destroy(error?: Error): this {
    if (this.isClosed) {
      this.peer.logger.warn({ streamId: this.id }, 'Attempt to destroy already closed stream');
      return this;
    }

    this.peer.logger.info({ streamId: this.id, error }, 'Destroying stream');
    this.isClosed = true;
    super.destroy(error);
    this.cleanup();

    return this;
  }

  /**
   * Factory method for creating new NetronReadableStream instances.
   * This method provides a convenient way to create stream instances
   * with default configuration.
   *
   * @param {RemotePeer} peer - The remote peer for this stream
   * @param {number} streamId - Unique identifier for the stream
   * @param {boolean} [isLive=false] - Whether this is a live stream
   * @returns {NetronReadableStream}
   */
  public static create(peer: RemotePeer, streamId: number, isLive: boolean = false): NetronReadableStream {
    return new NetronReadableStream({ peer, streamId, isLive });
  }
}
