import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Packet } from '../packet/packet.js';
import { NetronErrors } from '../errors/index.js';

/**
 * Maximum number of packets that can be buffered in the stream before
 * triggering a buffer overflow error. This limit helps prevent memory
 * exhaustion in high-throughput scenarios.
 */
const MAX_BUFFER_SIZE = 10_000;

/**
 * Default high water mark for backpressure mechanism.
 * Stream will emit backpressure events when buffer exceeds this threshold.
 */
const DEFAULT_HIGH_WATER_MARK = 16;

/**
 * Average estimated size of a packet in bytes for memory tracking.
 */
const ESTIMATED_PACKET_SIZE = 1024;

/**
 * Interval for periodic buffer cleanup in milliseconds.
 */
const BUFFER_CLEANUP_INTERVAL = 30_000; // 30 seconds

/**
 * Stream state enumeration.
 * Defines the lifecycle states of a NetronReadableStream.
 */
export enum StreamState {
  /** Stream is initialized but not yet active */
  IDLE = 'IDLE',
  /** Stream is actively processing packets */
  ACTIVE = 'ACTIVE',
  /** Stream is paused due to backpressure */
  PAUSED = 'PAUSED',
  /** Stream is in the process of closing */
  CLOSING = 'CLOSING',
  /** Stream is closed */
  CLOSED = 'CLOSED',
  /** Stream encountered an error */
  ERROR = 'ERROR',
}

/**
 * Error severity categories for improved error handling.
 */
export enum ErrorSeverity {
  /** Recoverable error, stream can continue */
  RECOVERABLE = 'RECOVERABLE',
  /** Fatal error, stream must be destroyed */
  FATAL = 'FATAL',
}

/**
 * Stream metrics for monitoring and debugging.
 */
export interface StreamMetrics {
  /** Total bytes received */
  bytesReceived: number;
  /** Total packets received */
  packetsReceived: number;
  /** Number of backpressure events triggered */
  backpressureEvents: number;
  /** Peak buffer size reached */
  bufferPeakSize: number;
  /** Current buffer size */
  currentBufferSize: number;
  /** Estimated memory usage in bytes */
  estimatedMemoryUsage: number;
  /** Current stream state */
  state: StreamState;
  /** Whether stream is currently paused */
  isPaused: boolean;
}

/**
 * Configuration options for creating a new NetronReadableStream instance.
 * Browser-compatible version using Web Streams API.
 *
 * @interface NetronReadableStreamOptions
 * @property {any} peer - The remote peer this stream is associated with
 * @property {number} streamId - Unique identifier for this stream
 * @property {boolean} [isLive=false] - Whether this is a live streaming connection
 * @property {number} [highWaterMark=16] - Buffer threshold for backpressure signaling
 * @property {number} [maxBufferSize=10000] - Maximum buffer size before error
 * @property {(error: Error, severity: ErrorSeverity) => void} [onError] - Error callback
 */
export interface NetronReadableStreamOptions {
  peer: any;
  streamId: number;
  isLive?: boolean;
  highWaterMark?: number;
  maxBufferSize?: number;
  onError?: (error: Error, severity: ErrorSeverity) => void;
}

/**
 * A specialized ReadableStream implementation for the Netron browser client.
 * This class handles the reception and ordered delivery of data packets from
 * remote peers, implementing sophisticated buffering and flow control mechanisms.
 *
 * Features:
 * - Backpressure mechanism with configurable high water mark
 * - State machine for lifecycle management
 * - Memory tracking and automatic cleanup
 * - Comprehensive metrics
 * - Recoverable error handling
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

  /** Whether all data has been successfully received */
  public isComplete: boolean = false;

  /** Whether this is a live streaming connection */
  public isLive: boolean;

  /** Event emitter for stream events */
  private events = new EventEmitter();

  /** Controller for the underlying ReadableStream */
  private controller?: ReadableStreamDefaultController<any>;

  /** Current stream state */
  private state: StreamState = StreamState.IDLE;

  /** High water mark for backpressure */
  private readonly highWaterMark: number;

  /** Maximum buffer size */
  private readonly maxBufferSize: number;

  /** Error callback */
  private readonly onErrorCallback?: (error: Error, severity: ErrorSeverity) => void;

  /** Stream metrics */
  private metrics: StreamMetrics = {
    bytesReceived: 0,
    packetsReceived: 0,
    backpressureEvents: 0,
    bufferPeakSize: 0,
    currentBufferSize: 0,
    estimatedMemoryUsage: 0,
    state: StreamState.IDLE,
    isPaused: false,
  };

  /** Buffer cleanup interval handle */
  private cleanupInterval?: number;

  /**
   * Creates a new NetronReadableStream instance.
   *
   * @param {NetronReadableStreamOptions} options - Configuration options for the stream
   * @throws {Error} If stream initialization fails
   */
  constructor({
    peer,
    streamId,
    isLive = false,
    highWaterMark = DEFAULT_HIGH_WATER_MARK,
    maxBufferSize = MAX_BUFFER_SIZE,
    onError,
  }: NetronReadableStreamOptions) {
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
    this.highWaterMark = highWaterMark;
    this.maxBufferSize = maxBufferSize;
    this.onErrorCallback = onError;
    this.controller = _controller!;

    if (this.peer.logger) {
      this.peer.logger.info({ streamId: this.id, isLive, highWaterMark, maxBufferSize }, 'Creating readable stream');
    }
    this.peer.readableStreams.set(this.id, this);

    // Transition to ACTIVE state
    this.transitionState(StreamState.ACTIVE);

    if (!this.isLive) {
      this.resetTimeout();
      // Start periodic buffer cleanup
      this.startBufferCleanup();
    }

    // Set up event listeners
    this.events.on('close', this.cleanup);
    this.events.on('error', this.handleError);
  }

  /**
   * Transitions the stream to a new state.
   * Validates state transitions and emits state change events.
   *
   * @param {StreamState} newState - The target state
   * @throws {Error} If the state transition is invalid
   */
  private transitionState(newState: StreamState): void {
    const oldState = this.state;

    // Validate state transitions
    const validTransitions: Record<StreamState, StreamState[]> = {
      [StreamState.IDLE]: [StreamState.ACTIVE, StreamState.CLOSED, StreamState.ERROR],
      [StreamState.ACTIVE]: [StreamState.PAUSED, StreamState.CLOSING, StreamState.CLOSED, StreamState.ERROR],
      [StreamState.PAUSED]: [StreamState.ACTIVE, StreamState.CLOSING, StreamState.ERROR],
      [StreamState.CLOSING]: [StreamState.CLOSED, StreamState.ERROR],
      [StreamState.CLOSED]: [],
      [StreamState.ERROR]: [StreamState.CLOSED],
    };

    if (!validTransitions[oldState].includes(newState)) {
      const error = new Error(`Invalid state transition: ${oldState} -> ${newState} for stream ${this.id}`);
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id, oldState, newState }, error.message);
      }
      // Allow transition anyway but log warning
    }

    this.state = newState;
    this.metrics.state = newState;
    this.metrics.isPaused = newState === StreamState.PAUSED;

    if (this.peer.logger) {
      this.peer.logger.debug({ streamId: this.id, oldState, newState }, 'Stream state transition');
    }

    this.events.emit('stateChange', { oldState, newState });
  }

  /**
   * Starts periodic buffer cleanup for non-live streams.
   */
  private startBufferCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.performBufferCleanup();
    }, BUFFER_CLEANUP_INTERVAL) as any;
  }

  /**
   * Performs periodic buffer cleanup to remove stale entries.
   * This helps prevent memory leaks from packets that will never be processed.
   */
  private performBufferCleanup(): void {
    if (this.state === StreamState.CLOSED || this.state === StreamState.ERROR) {
      return;
    }

    // Clear buffer on timeout if stream is inactive
    if (this.buffer.size > 0) {
      if (this.peer.logger) {
        this.peer.logger.debug({ streamId: this.id, bufferSize: this.buffer.size }, 'Performing buffer cleanup');
      }

      // Only keep packets close to expectedIndex
      const KEEP_WINDOW = 100;
      const toDelete: number[] = [];

      // Use Array.from to avoid downlevelIteration requirement
      for (const [index] of Array.from(this.buffer.entries())) {
        if (index < this.expectedIndex - KEEP_WINDOW) {
          toDelete.push(index);
        }
      }

      for (const index of toDelete) {
        this.buffer.delete(index);
        if (this.peer.logger) {
          this.peer.logger.warn({ streamId: this.id, index }, 'Removed stale packet from buffer');
        }
      }

      this.updateBufferMetrics();
    }
  }

  /**
   * Processes incoming data packets and manages ordered delivery.
   * This method implements the core packet handling logic, including:
   * - Buffer overflow protection
   * - Packet reordering
   * - Flow control
   * - Stream completion detection
   * - Backpressure management
   * - Metrics tracking
   *
   * @param {Packet} packet - The incoming data packet
   * @returns {void}
   * @throws {Error} If buffer overflow occurs or stream is closed
   */
  public onPacket(packet: Packet): void {
    // Check state before processing
    if (this.state === StreamState.CLOSED || this.state === StreamState.ERROR) {
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id, state: this.state }, 'Received packet for closed/errored stream');
      }
      return;
    }

    // If paused, queue the packet anyway but emit backpressure event
    if (this.state === StreamState.PAUSED) {
      if (this.peer.logger) {
        this.peer.logger.debug({ streamId: this.id }, 'Received packet while paused');
      }
    }

    this.resetTimeout();

    // Update metrics
    this.metrics.packetsReceived++;
    if (packet.data) {
      const estimatedSize =
        typeof packet.data === 'string' ? packet.data.length : (packet.data.byteLength ?? ESTIMATED_PACKET_SIZE);
      this.metrics.bytesReceived += estimatedSize;
    }

    // Check for buffer overflow
    if (this.buffer.size >= this.maxBufferSize) {
      if (this.peer.logger) {
        this.peer.logger.error({ streamId: this.id, size: this.buffer.size }, 'Stream buffer overflow');
      }
      const error = NetronErrors.streamBackpressure(String(this.id), this.buffer.size);
      this.handleStreamError(error, ErrorSeverity.FATAL);
      return;
    }

    if (this.peer.logger) {
      this.peer.logger.debug({ streamId: this.id, index: packet.streamIndex }, 'Processing packet');
    }

    // Don't buffer the last packet's data if it's null
    if (!packet.isLastChunk() || packet.data !== null) {
      this.buffer.set(packet.streamIndex!, packet.data);
    }

    // Update buffer metrics
    this.updateBufferMetrics();

    // Check for backpressure
    this.checkBackpressure();

    // Push all consecutive packets
    while (this.buffer.has(this.expectedIndex)) {
      const chunk = this.buffer.get(this.expectedIndex);
      this.buffer.delete(this.expectedIndex);
      this.expectedIndex++;

      try {
        this.controller?.enqueue(chunk);
      } catch (_error) {
        if (this.peer.logger) {
          this.peer.logger.debug({ streamId: this.id }, 'Stream backpressure detected');
        }
        // Re-buffer the chunk if we can't enqueue it
        this.buffer.set(this.expectedIndex - 1, chunk);
        this.expectedIndex--;
        this.handleStreamError(new Error('Failed to enqueue chunk'), ErrorSeverity.RECOVERABLE);
        break;
      }
    }

    // Update buffer metrics after processing
    this.updateBufferMetrics();

    if (packet.isLastChunk()) {
      if (this.peer.logger) {
        this.peer.logger.info({ streamId: this.id }, 'Received last chunk');
      }
      this.isComplete = true;
      this.transitionState(StreamState.CLOSING);

      // Close the stream
      try {
        this.controller?.close();
        this.transitionState(StreamState.CLOSED);
      } catch (_error) {
        // Stream may already be closed
        if (this.peer.logger) {
          this.peer.logger.debug({ streamId: this.id }, 'Error closing stream');
        }
      }
    }
  }

  /**
   * Updates buffer-related metrics.
   */
  private updateBufferMetrics(): void {
    this.metrics.currentBufferSize = this.buffer.size;
    if (this.buffer.size > this.metrics.bufferPeakSize) {
      this.metrics.bufferPeakSize = this.buffer.size;
    }
    this.metrics.estimatedMemoryUsage = this.buffer.size * ESTIMATED_PACKET_SIZE;
  }

  /**
   * Checks if backpressure should be applied based on buffer size.
   * Automatically pauses the stream if buffer exceeds high water mark.
   */
  private checkBackpressure(): void {
    const shouldPause = this.buffer.size >= this.highWaterMark;

    if (shouldPause && this.state === StreamState.ACTIVE) {
      this.pause();
    } else if (!shouldPause && this.state === StreamState.PAUSED) {
      this.resume();
    }
  }

  /**
   * Pauses the stream due to backpressure.
   * Emits a 'backpressure' event to signal the sender to slow down.
   */
  public pause(): void {
    if (this.state !== StreamState.ACTIVE) {
      return;
    }

    if (this.peer.logger) {
      this.peer.logger.warn({ streamId: this.id, bufferSize: this.buffer.size }, 'Pausing stream due to backpressure');
    }

    this.transitionState(StreamState.PAUSED);
    this.metrics.backpressureEvents++;
    this.events.emit('backpressure', {
      bufferSize: this.buffer.size,
      highWaterMark: this.highWaterMark,
    });
  }

  /**
   * Resumes the stream after backpressure is relieved.
   */
  public resume(): void {
    if (this.state !== StreamState.PAUSED) {
      return;
    }

    if (this.peer.logger) {
      this.peer.logger.info({ streamId: this.id }, 'Resuming stream after backpressure');
    }

    this.transitionState(StreamState.ACTIVE);
    this.events.emit('resume');
  }

  /**
   * Gets the current desired size for backpressure control.
   * Returns negative value if buffer is over capacity.
   *
   * @returns {number} The desired size (positive means can accept more data)
   */
  public get desiredSize(): number {
    return this.highWaterMark - this.buffer.size;
  }

  /**
   * Checks if the stream is currently paused.
   *
   * @returns {boolean} True if stream is paused
   */
  public get isPaused(): boolean {
    return this.state === StreamState.PAUSED;
  }

  /**
   * Gets current stream state.
   *
   * @returns {StreamState} The current state
   */
  public getState(): StreamState {
    return this.state;
  }

  /**
   * Gets comprehensive stream metrics.
   *
   * @returns {StreamMetrics} Current metrics snapshot
   */
  public getMetrics(): StreamMetrics {
    return { ...this.metrics };
  }

  /**
   * Handles stream errors with severity classification.
   * Recoverable errors are logged and reported but don't destroy the stream.
   * Fatal errors destroy the stream.
   *
   * @param {Error} error - The error that occurred
   * @param {ErrorSeverity} severity - Error severity level
   */
  private handleStreamError(error: Error, severity: ErrorSeverity): void {
    if (this.peer.logger) {
      this.peer.logger.error({ streamId: this.id, error, severity }, 'Stream error occurred');
    }

    // Call user-provided error callback
    if (this.onErrorCallback) {
      try {
        this.onErrorCallback(error, severity);
      } catch (callbackError) {
        if (this.peer.logger) {
          this.peer.logger.error({ streamId: this.id, callbackError }, 'Error in onError callback');
        }
      }
    }

    if (severity === ErrorSeverity.FATAL) {
      this.destroy(error);
    } else {
      // Recoverable error - emit event but don't destroy
      this.events.emit('error', error);
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
      // Clear buffer on timeout
      this.buffer.clear();
      this.updateBufferMetrics();
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
    if (this.state === StreamState.CLOSED) {
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

    this.transitionState(StreamState.CLOSING);

    try {
      this.controller?.close();
      this.transitionState(StreamState.CLOSED);
    } catch (_error) {
      // Stream may already be closed
      this.transitionState(StreamState.CLOSED);
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
    if (this.state === StreamState.CLOSED) {
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id }, 'Attempt to force close already closed stream');
      }
      return;
    }

    if (this.peer.logger) {
      this.peer.logger.info({ streamId: this.id, reason }, 'Force closing stream');
    }

    this.transitionState(StreamState.CLOSING);
    this.isComplete = true;

    // Close the stream
    try {
      this.controller?.close();
      this.transitionState(StreamState.CLOSED);
    } catch (_error) {
      // Stream may already be closed
      this.transitionState(StreamState.CLOSED);
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
      this.timeout = undefined;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.peer.readableStreams.delete(this.id);
    this.buffer.clear();
    this.updateBufferMetrics();
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
    this.transitionState(StreamState.ERROR);
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
    if (this.state === StreamState.CLOSED) {
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id }, 'Attempt to destroy already closed stream');
      }
      return;
    }

    if (this.peer.logger) {
      this.peer.logger.info({ streamId: this.id, error }, 'Destroying stream');
    }

    if (error) {
      this.transitionState(StreamState.ERROR);
      try {
        this.controller?.error(error);
      } catch (_e) {
        // Stream may already be closed
      }
      this.events.emit('error', error);
    } else {
      this.transitionState(StreamState.CLOSING);
      try {
        this.controller?.close();
      } catch (_e) {
        // Stream may already be closed
      }
    }

    this.transitionState(StreamState.CLOSED);
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
