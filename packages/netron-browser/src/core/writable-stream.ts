import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Uid } from '../packet/uid.js';
import { Packet, createPacket, TYPE_STREAM_ERROR, TYPE_STREAM_CLOSE } from '../packet/index.js';
import { NetronErrors } from '../errors/index.js';

/**
 * Global UID generator instance for creating unique stream identifiers.
 * This ensures that each stream gets a unique ID across the application.
 */
const uid = new Uid();

/**
 * Configuration options for creating a NetronWritableStream instance.
 * Browser-compatible version using Web Streams API.
 *
 * @interface NetronWritableStreamOptions
 * @property {any} peer - The remote peer this stream is associated with
 * @property {number} [streamId] - Optional custom stream identifier
 * @property {boolean} [isLive] - Whether the stream is operating in live/real-time mode
 */
export interface NetronWritableStreamOptions {
  peer: any;
  streamId?: number;
  isLive?: boolean;
}

/**
 * A specialized writable stream implementation for the Netron browser client.
 * This class extends the browser's WritableStream to provide distributed stream capabilities
 * with proper error handling, cleanup, and remote peer communication.
 *
 * @class NetronWritableStream
 * @extends {WritableStream}
 * @property {number} id - Unique identifier for this stream instance
 * @property {any} peer - The remote peer this stream is associated with
 * @property {boolean} isLive - Indicates if the stream is operating in live mode
 */
export class NetronWritableStream extends WritableStream<any> {
  /** Unique identifier for this stream instance */
  public readonly id: number;

  /** The remote peer this stream is associated with */
  public readonly peer: any;

  /** Current chunk index for maintaining write order */
  private index: number = 0;

  /** Whether the stream is operating in live/real-time mode */
  public isLive: boolean;

  /** Flag indicating if the stream has been closed */
  private isClosed: boolean = false;

  /** Event emitter for stream events */
  private events = new EventEmitter();

  /** Controller for the underlying WritableStream (stored for potential future use) */
  // @ts-expect-error - controller is assigned but not currently used; kept for potential future enhancements
  private controller?: WritableStreamDefaultController;

  /**
   * Creates a new NetronWritableStream instance.
   *
   * @constructor
   * @param {NetronWritableStreamOptions} options - Configuration options for the stream
   * @param {any} options.peer - The remote peer this stream is associated with
   * @param {number} [options.streamId] - Optional custom stream identifier
   * @param {boolean} [options.isLive=false] - Whether the stream is operating in live mode
   */
  constructor({ peer, streamId, isLive = false }: NetronWritableStreamOptions) {
    super({
      start: (controller) => {
        this.controller = controller;
      },
      write: async (chunk) => this._write(chunk),
      close: async () => this._final(),
      abort: (reason) => {
        this._abort(reason);
      },
    });

    this.peer = peer;
    this.isLive = isLive;
    this.id = streamId ?? uid.next();

    if (this.peer.logger) {
      this.peer.logger.info({ streamId: this.id, isLive }, 'Creating writable stream');
    }
    this.peer.writableStreams.set(this.id, this);

    this.events.once('close', this.cleanup);
  }

  /**
   * Pipes data from an AsyncIterable or ReadableStream into this stream.
   * Handles backpressure and ensures proper cleanup on errors.
   *
   * @param {AsyncIterable<any> | ReadableStream<any>} source - The source stream to pipe from
   * @returns {Promise<void>} A promise that resolves when piping is complete
   * @throws {Error} If an error occurs during the piping process
   */
  public async pipeFrom(source: AsyncIterable<any> | ReadableStream<any>): Promise<void> {
    if (this.peer.logger) {
      this.peer.logger.debug({ streamId: this.id }, 'Starting pipe operation');
    }

    const writer = this.getWriter();

    try {
      if (Symbol.asyncIterator in source) {
        // Handle AsyncIterable
        for await (const chunk of source as AsyncIterable<any>) {
          await writer.write(chunk);
        }
      } else {
        // Handle ReadableStream
        const reader = (source as ReadableStream<any>).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writer.write(value);
          }
        } finally {
          reader.releaseLock();
        }
      }

      await writer.close();
      if (this.peer.logger) {
        this.peer.logger.debug({ streamId: this.id }, 'Pipe operation completed');
      }
    } catch (error) {
      if (this.peer.logger) {
        this.peer.logger.error({ streamId: this.id, error }, 'Pipe operation failed');
      }
      await writer.abort(error);
      throw error;
    } finally {
      writer.releaseLock();
    }
  }

  /**
   * Internal write implementation for handling stream chunks.
   * Sends data to the remote peer and manages stream state.
   *
   * @param {any} chunk - The data chunk to write
   * @returns {Promise<void>}
   */
  private async _write(chunk: any): Promise<void> {
    if (this.isClosed) {
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id }, 'Attempt to write to closed stream');
      }
      throw NetronErrors.streamClosed(String(this.id), 'Attempt to write to closed stream');
    }

    if (this.peer.logger) {
      this.peer.logger.debug({ streamId: this.id, index: this.index }, 'Writing chunk');
    }

    try {
      await this.peer.sendStreamChunk(this.id, chunk, this.index++, false, this.isLive);
    } catch (err: any) {
      if (this.peer.logger) {
        this.peer.logger.error({ streamId: this.id, error: err }, 'Error sending stream chunk');
      }

      // Send error packet to remote peer (best effort)
      try {
        await this.peer.sendPacket(
          createPacket(Packet.nextId(), 1, TYPE_STREAM_ERROR, {
            streamId: this.id,
            message: err.message,
          })
        );
      } catch (sendErr) {
        if (this.peer.logger) {
          this.peer.logger.error({ streamId: this.id, error: sendErr }, 'Failed to send stream error packet');
        }
      }

      throw err;
    }
  }

  /**
   * Internal final implementation for handling stream completion.
   * Sends final chunk to remote peer and performs cleanup.
   *
   * @returns {Promise<void>}
   */
  private async _final(): Promise<void> {
    if (this.isClosed) {
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id }, 'Attempt to finalize closed stream');
      }
      throw NetronErrors.streamClosed(String(this.id), 'Attempt to finalize closed stream');
    }

    if (this.peer.logger) {
      this.peer.logger.debug({ streamId: this.id, index: this.index }, 'Sending final chunk');
    }

    try {
      await this.peer.sendStreamChunk(this.id, null, this.index, true, this.isLive);
    } catch (err: any) {
      if (this.peer.logger) {
        this.peer.logger.error({ streamId: this.id, error: err }, 'Error sending final chunk');
      }
      throw err;
    } finally {
      this.closeStream();
    }
  }

  /**
   * Internal abort implementation for handling stream abortion.
   * Sends close notification to remote peer.
   *
   * @param {any} reason - The reason for abortion
   */
  private _abort(reason: any): void {
    if (this.peer.logger) {
      this.peer.logger.info({ streamId: this.id, reason }, 'Aborting stream');
    }

    const error = reason instanceof Error ? reason : new Error(String(reason));
    this.destroy(error);
  }

  /**
   * Gracefully closes the stream and performs cleanup.
   * This method ensures proper resource cleanup and state management.
   */
  public closeStream(): void {
    if (this.isClosed) {
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id }, 'Attempt to close already closed stream');
      }
      return;
    }

    if (this.peer.logger) {
      this.peer.logger.info({ streamId: this.id }, 'Closing stream');
    }
    this.isClosed = true;
    this.cleanup();
  }

  /**
   * Destroys the stream and sends close notification to remote peer.
   * Sends a close notification packet to the remote peer for immediate stream termination.
   *
   * @param {Error} [error] - Optional error that caused the destruction
   */
  public destroy(error?: Error): void {
    if (this.isClosed) {
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id }, 'Attempt to destroy already closed stream');
      }
      return;
    }

    if (this.peer.logger) {
      this.peer.logger.info({ streamId: this.id, error }, 'Destroying stream');
    }
    this.isClosed = true;

    // Perform cleanup immediately
    this.cleanup();

    if (error) {
      this.events.emit('error', error);
    }

    // Send explicit close packet for immediate notification (best effort)
    const closeReason = error ? error.message : 'Stream destroyed';
    this.peer
      .sendPacket(
        createPacket(Packet.nextId(), 1, TYPE_STREAM_CLOSE, {
          streamId: this.id,
          reason: closeReason,
        })
      )
      .catch((sendError: Error) => {
        if (this.peer.logger) {
          this.peer.logger.error({ streamId: this.id, error: sendError }, 'Failed to send stream close packet');
        }
      });
  }

  /**
   * Internal cleanup method that removes stream references from the peer.
   * This ensures proper garbage collection and prevents memory leaks.
   */
  private cleanup = () => {
    if (this.peer.logger) {
      this.peer.logger.debug({ streamId: this.id }, 'Cleaning up stream resources');
    }
    this.peer.writableStreams.delete(this.id);
  };

  /**
   * Registers an event listener.
   *
   * @param {string} event - The event name
   * @param {(...args: any[]) => void} listener - The event handler
   */
  public on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }

  /**
   * Registers a one-time event listener.
   *
   * @param {string} event - The event name
   * @param {(...args: any[]) => void} listener - The event handler
   */
  public once(event: string, listener: (...args: any[]) => void): void {
    this.events.once(event, listener);
  }

  /**
   * Factory method for creating a NetronWritableStream instance.
   * Optionally pipes data from a source stream if provided.
   *
   * @static
   * @param {any} peer - The remote peer this stream is associated with
   * @param {AsyncIterable<any> | ReadableStream<any>} [source] - Optional source stream to pipe from
   * @param {boolean} [isLive=false] - Whether the stream is operating in live mode
   * @param {number} [streamId] - Optional custom stream identifier
   * @returns {NetronWritableStream} A new stream instance
   */
  public static create(
    peer: any,
    source?: AsyncIterable<any> | ReadableStream<any>,
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
