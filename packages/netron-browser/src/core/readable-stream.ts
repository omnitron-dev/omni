import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Packet } from '../packet/index.js';
import { NetronErrors } from '../errors/index.js';

/**
 * Maximum number of packets that can be buffered in the stream before
 * triggering a buffer overflow error. This limit helps prevent memory
 * exhaustion in high-throughput scenarios.
 */
const MAX_BUFFER_SIZE = 10_000;

/**
 * Configuration options for creating a new NetronReadableStream instance.
 * Browser-compatible version using Web Streams API.
 *
 * @interface NetronReadableStreamOptions
 * @property {any} peer - The remote peer this stream is associated with
 * @property {number} streamId - Unique identifier for this stream
 * @property {boolean} [isLive=false] - Whether this is a live streaming connection
 */
export interface NetronReadableStreamOptions {
  peer: any;
  streamId: number;
  isLive?: boolean;
}

/**
 * A specialized ReadableStream implementation for the Netron browser client.
 * This class handles the reception and ordered delivery of data packets from
 * remote peers, implementing sophisticated buffering and flow control mechanisms.
 *
 * Uses the browser's native Web Streams API for compatibility.
 *
 * @class NetronReadableStream
 * @extends ReadableStream
 * @description Implements a reliable, ordered data stream for peer-to-peer communication
 */
export class NetronReadableStream extends ReadableStream<any> {
  /** The remote peer this stream is associated with */
  public readonly peer: any;

  /** Internal buffer for storing out-of-order packets */
  private buffer: Map<number, any> = new Map();

  /** Next expected packet index for ordered delivery */
  private expectedIndex: number = 0;

  /** Timeout handle for stream inactivity detection */
  private timeout?: number;

  /** Unique identifier for this stream */
  public readonly id: number;

  /** Whether the stream has been closed */
  private isClosed: boolean = false;

  /** Whether all data has been successfully received */
  public isComplete: boolean = false;

  /** Whether this is a live streaming connection */
  public isLive: boolean;

  /** Event emitter for stream events */
  private events = new EventEmitter();

  /** Controller for the underlying ReadableStream */
  private controller?: ReadableStreamDefaultController<any>;

  /**
   * Creates a new NetronReadableStream instance.
   *
   * @param {NetronReadableStreamOptions} options - Configuration options for the stream
   * @throws {Error} If stream initialization fails
   */
  constructor({ peer, streamId, isLive = false }: NetronReadableStreamOptions) {
    let _controller: ReadableStreamDefaultController<any>;

    super({
      start(controller) {
        _controller = controller;
      },
      pull() {
        // Data is pushed in onPacket, no action needed here
      },
      cancel(reason) {
        // Handle cancellation
        console.log(`Stream ${streamId} cancelled:`, reason);
      },
    });

    this.peer = peer;
    this.id = streamId;
    this.isLive = isLive;
    this.controller = _controller!;

    if (this.peer.logger) {
      this.peer.logger.info({ streamId: this.id, isLive }, 'Creating readable stream');
    }
    this.peer.readableStreams.set(this.id, this);

    if (!this.isLive) {
      this.resetTimeout();
    }

    // Set up event listeners
    this.events.on('close', this.cleanup);
    this.events.on('error', this.handleError);
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
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id }, 'Received packet for closed stream');
      }
      return;
    }

    this.resetTimeout();

    if (this.buffer.size > MAX_BUFFER_SIZE) {
      if (this.peer.logger) {
        this.peer.logger.error({ streamId: this.id, size: this.buffer.size }, 'Stream buffer overflow');
      }
      this.destroy(NetronErrors.streamBackpressure(String(this.id), this.buffer.size));
      return;
    }

    if (this.peer.logger) {
      this.peer.logger.debug({ streamId: this.id, index: packet.streamIndex }, 'Processing packet');
    }

    // Don't buffer the last packet's data if it's null
    if (!packet.isLastChunk() || packet.data !== null) {
      this.buffer.set(packet.streamIndex!, packet.data);
    }

    // Push all consecutive packets
    while (this.buffer.has(this.expectedIndex)) {
      const chunk = this.buffer.get(this.expectedIndex);
      this.buffer.delete(this.expectedIndex);
      this.expectedIndex++;

      try {
        this.controller?.enqueue(chunk);
      } catch (error) {
        if (this.peer.logger) {
          this.peer.logger.debug({ streamId: this.id }, 'Stream backpressure detected');
        }
        // Re-buffer the chunk if we can't enqueue it
        this.buffer.set(this.expectedIndex - 1, chunk);
        this.expectedIndex--;
        break;
      }
    }

    if (packet.isLastChunk()) {
      if (this.peer.logger) {
        this.peer.logger.info({ streamId: this.id }, 'Received last chunk');
      }
      this.isComplete = true;

      // Close the stream
      try {
        this.controller?.close();
      } catch (error) {
        // Stream may already be closed
      }
    }
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

    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    // Use stream timeout from peer options (defaults to 60 seconds)
    const timeoutDuration = this.peer.options?.streamTimeout ?? 60000;
    if (this.peer.logger) {
      this.peer.logger.debug({ streamId: this.id, timeoutDuration }, 'Resetting stream timeout');
    }

    this.timeout = setTimeout(() => {
      const message = `Stream ${this.id} inactive for ${timeoutDuration}ms, closing.`;
      if (this.peer.logger) {
        this.peer.logger.warn(message);
      }
      this.destroy(NetronErrors.streamClosed(String(this.id), message));
    }, timeoutDuration) as any;
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
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id }, 'Attempt to close already closed stream');
      }
      return;
    }

    if (this.isLive && !force) {
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id }, 'Attempt to close live stream');
      }
      return;
    }

    if (this.peer.logger) {
      this.peer.logger.info({ streamId: this.id, force }, 'Closing stream');
    }

    try {
      this.controller?.close();
    } catch (error) {
      // Stream may already be closed
    }

    if (this.isLive && force) {
      this.destroy();
    }
  }

  /**
   * Forces immediate stream closure due to remote stream termination.
   * This method is called when receiving an explicit close packet from the remote peer.
   * It immediately closes the stream and emits appropriate events.
   *
   * @param {string} [reason] - Optional reason for the forced closure
   * @returns {void}
   */
  public forceClose(reason?: string): void {
    if (this.isClosed) {
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id }, 'Attempt to force close already closed stream');
      }
      return;
    }

    if (this.peer.logger) {
      this.peer.logger.info({ streamId: this.id, reason }, 'Force closing stream');
    }
    this.isClosed = true;
    this.isComplete = true;

    // Close the stream
    try {
      this.controller?.close();
    } catch (error) {
      // Stream may already be closed
    }

    // Emit close event for listeners
    setTimeout(() => {
      this.events.emit('close');
      this.cleanup();
    }, 0);
  }

  /**
   * Performs cleanup operations when the stream is closed.
   * This method ensures proper resource deallocation and stream deregistration.
   *
   * @returns {void}
   */
  private cleanup = (): void => {
    if (this.peer.logger) {
      this.peer.logger.debug({ streamId: this.id }, 'Cleaning up stream resources');
    }
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
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
    if (this.peer.logger) {
      this.peer.logger.error({ streamId: this.id, error }, 'Stream error occurred');
    }
    this.cleanup();
  };

  /**
   * Destroys the stream with an optional error.
   * This method implements a robust stream termination process that
   * guarantees resource cleanup and error propagation.
   *
   * @param {Error} [error] - Optional error to propagate
   * @returns {void}
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

    if (error) {
      try {
        this.controller?.error(error);
      } catch (e) {
        // Stream may already be closed
      }
      this.events.emit('error', error);
    } else {
      try {
        this.controller?.close();
      } catch (e) {
        // Stream may already be closed
      }
    }

    this.cleanup();
  }

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
   * Factory method for creating new NetronReadableStream instances.
   * This method provides a convenient way to create stream instances
   * with default configuration.
   *
   * @param {any} peer - The remote peer for this stream
   * @param {number} streamId - Unique identifier for the stream
   * @param {boolean} [isLive=false] - Whether this is a live stream
   * @returns {NetronReadableStream}
   */
  public static create(peer: any, streamId: number, isLive: boolean = false): NetronReadableStream {
    return new NetronReadableStream({ peer, streamId, isLive });
  }
}
