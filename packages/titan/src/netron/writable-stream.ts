import { Writable, Readable, WritableOptions } from 'readable-stream';

import { Uid } from './uid.js';
import { RemotePeer } from './remote-peer.js';
import { Packet, createPacket, TYPE_STREAM_ERROR, TYPE_STREAM_CLOSE } from './packet/index.js';
import { NetronErrors } from '../errors/index.js';

/**
 * Global UID generator instance for creating unique stream identifiers.
 * This ensures that each stream gets a unique ID across the application.
 */
const uid = new Uid();

/**
 * Configuration options for creating a NetronWritableStream instance.
 * Extends Node.js WritableOptions with Netron-specific properties.
 *
 * @interface NetronWritableStreamOptions
 * @extends {WritableOptions}
 * @property {RemotePeer} peer - The remote peer this stream is associated with
 * @property {number} [streamId] - Optional custom stream identifier
 * @property {boolean} [isLive] - Whether the stream is operating in live/real-time mode
 */
export interface NetronWritableStreamOptions extends WritableOptions {
  peer: RemotePeer;
  streamId?: number;
  isLive?: boolean;
}

/**
 * A specialized writable stream implementation for the Netron distributed system.
 * This class extends Node.js Writable stream to provide distributed stream capabilities
 * with proper error handling, cleanup, and remote peer communication.
 *
 * @class NetronWritableStream
 * @extends {Writable}
 * @property {number} id - Unique identifier for this stream instance
 * @property {RemotePeer} peer - The remote peer this stream is associated with
 * @property {boolean} isLive - Indicates if the stream is operating in live mode
 */
export class NetronWritableStream extends Writable {
  /** Unique identifier for this stream instance */
  public readonly id: number;

  /** The remote peer this stream is associated with */
  public readonly peer: RemotePeer;

  /** Current chunk index for maintaining write order */
  private index: number = 0;

  /** Whether the stream is operating in live/real-time mode */
  public isLive: boolean;

  /** Flag indicating if the stream has been closed */
  private isClosed: boolean = false;

  /**
   * Creates a new NetronWritableStream instance.
   *
   * @constructor
   * @param {NetronWritableStreamOptions} options - Configuration options for the stream
   * @param {RemotePeer} options.peer - The remote peer this stream is associated with
   * @param {number} [options.streamId] - Optional custom stream identifier
   * @param {boolean} [options.isLive=false] - Whether the stream is operating in live mode
   * @param {WritableOptions} [options] - Additional Node.js stream options
   */
  constructor({ peer, streamId, isLive = false, ...opts }: NetronWritableStreamOptions) {
    super({ ...opts, objectMode: true });

    this.peer = peer;
    this.isLive = isLive;
    this.id = streamId ?? uid.next();

    this.peer.logger.info({ streamId: this.id, isLive }, 'Creating writable stream');
    this.peer.writableStreams.set(this.id, this);

    this.once('close', this.cleanup);
    // Don't automatically consume error events - let them propagate to consumers
    // this.once('error', this.handleError);
  }

  /**
   * Pipes data from an AsyncIterable or Readable stream into this stream.
   * Handles backpressure and ensures proper cleanup on errors.
   *
   * @param {AsyncIterable<any> | Readable} source - The source stream to pipe from
   * @returns {Promise<void>} A promise that resolves when piping is complete
   * @throws {Error} If an error occurs during the piping process
   */
  public async pipeFrom(source: AsyncIterable<any> | Readable): Promise<void> {
    this.peer.logger.debug({ streamId: this.id }, 'Starting pipe operation');
    try {
      for await (const chunk of source) {
        if (!this.write(chunk)) {
          this.peer.logger.debug({ streamId: this.id }, 'Stream backpressure detected');
          await new Promise((resolve) => this.once('drain', resolve));
        }
      }
      this.end();
      this.peer.logger.debug({ streamId: this.id }, 'Pipe operation completed');
    } catch (error) {
      this.peer.logger.error({ streamId: this.id, error }, 'Pipe operation failed');
      this.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Internal write implementation for handling stream chunks.
   * Sends data to the remote peer and manages stream state.
   *
   * @override
   * @param {any} chunk - The data chunk to write
   * @param {BufferEncoding} _ - Unused encoding parameter
   * @param {(error?: Error | null) => void} callback - Callback to signal write completion
   */
  override _write(chunk: any, _: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.isClosed) {
      this.peer.logger.warn({ streamId: this.id }, 'Attempt to write to closed stream');
      callback(NetronErrors.streamClosed(String(this.id), 'Attempt to write to closed stream'));
      return;
    }

    this.peer.logger.debug({ streamId: this.id, index: this.index }, 'Writing chunk');
    this.peer
      .sendStreamChunk(this.id, chunk, this.index++, false, this.isLive)
      .then(() => callback())
      .catch((err: Error) => {
        this.peer.logger.error({ streamId: this.id, error: err }, 'Error sending stream chunk');

        // Send error packet to remote peer (best effort)
        this.peer
          .sendPacket(
            createPacket(Packet.nextId(), 1, TYPE_STREAM_ERROR, {
              streamId: this.id,
              message: err.message,
            })
          )
          .catch((sendErr) => {
            this.peer.logger.error({ streamId: this.id, error: sendErr }, 'Failed to send stream error packet');
          });

        // Call callback with error to trigger error event on the stream
        callback(err);
      });
  }

  /**
   * Internal final implementation for handling stream completion.
   * Sends final chunk to remote peer and performs cleanup.
   *
   * @override
   * @param {(error?: Error | null) => void} callback - Callback to signal finalization completion
   */
  override _final(callback: (error?: Error | null) => void): void {
    if (this.isClosed) {
      this.peer.logger.warn({ streamId: this.id }, 'Attempt to finalize closed stream');
      callback(NetronErrors.streamClosed(String(this.id), 'Attempt to finalize closed stream'));
      return;
    }

    this.peer.logger.debug({ streamId: this.id, index: this.index }, 'Sending final chunk');
    this.peer
      .sendStreamChunk(this.id, null, this.index, true, this.isLive)
      .then(() => callback())
      .catch((err: Error) => {
        this.peer.logger.error({ streamId: this.id, error: err }, 'Error sending final chunk');
        callback(err);
      })
      .finally(() => this.closeStream());
  }

  /**
   * Gracefully closes the stream and performs cleanup.
   * This method ensures proper resource cleanup and state management.
   */
  public closeStream(): void {
    if (this.isClosed) {
      this.peer.logger.warn({ streamId: this.id }, 'Attempt to close already closed stream');
      return;
    }

    this.peer.logger.info({ streamId: this.id }, 'Closing stream');
    this.isClosed = true;
    this.end();
    this.cleanup();
  }

  /**
   * Overrides the destroy method to ensure proper cleanup and error handling.
   * Sends a close notification packet to the remote peer for immediate stream termination.
   *
   * @override
   * @param {Error} [error] - Optional error that caused the destruction
   * @returns {this} The stream instance for chaining
   */
  public override destroy(error?: Error): this {
    if (this.isClosed) {
      this.peer.logger.warn({ streamId: this.id }, 'Attempt to destroy already closed stream');
      return this;
    }

    this.peer.logger.info({ streamId: this.id, error }, 'Destroying stream');
    this.isClosed = true;

    // Perform cleanup immediately
    this.cleanup();

    // Immediately call super.destroy to set the destroyed property and emit error if needed
    super.destroy(error);

    // Send explicit close packet for immediate notification (best effort)
    const closeReason = error ? error.message : 'Stream destroyed';
    this.peer
      .sendPacket(
        createPacket(Packet.nextId(), 1, TYPE_STREAM_CLOSE, {
          streamId: this.id,
          reason: closeReason,
        })
      )
      .catch((sendError) => {
        this.peer.logger.error({ streamId: this.id, error: sendError }, 'Failed to send stream close packet');
      });

    return this;
  }

  /**
   * Internal cleanup method that removes stream references from the peer.
   * This ensures proper garbage collection and prevents memory leaks.
   */
  private cleanup = () => {
    this.peer.logger.debug({ streamId: this.id }, 'Cleaning up stream resources');
    this.peer.writableStreams.delete(this.id);
  };

  /**
   * Error handler for stream errors.
   * Logs the error and performs cleanup operations.
   *
   * @param {Error} err - The error that occurred
   */
  private handleError = (err: Error) => {
    this.peer.logger.error({ streamId: this.id, error: err }, 'Stream error occurred');
    this.cleanup();
  };

  /**
   * Factory method for creating a NetronWritableStream instance.
   * Optionally pipes data from a source stream if provided.
   *
   * @static
   * @param {RemotePeer} peer - The remote peer this stream is associated with
   * @param {AsyncIterable<any> | Readable} [source] - Optional source stream to pipe from
   * @param {boolean} [isLive=false] - Whether the stream is operating in live mode
   * @param {number} [streamId] - Optional custom stream identifier
   * @returns {NetronWritableStream} A new stream instance
   */
  public static create(
    peer: RemotePeer,
    source?: AsyncIterable<any> | Readable,
    isLive: boolean = false,
    streamId?: number
  ): NetronWritableStream {
    const stream = new NetronWritableStream({ peer, streamId, isLive });

    if (source) {
      stream.pipeFrom(source);
    }

    return stream;
  }
}
