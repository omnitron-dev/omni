import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Uid } from '../packet/uid.js';
import { Packet, createPacket } from '../packet/packet.js';
import { TYPE_STREAM_ERROR, TYPE_STREAM_CLOSE } from '../packet/types.js';
import { NetronErrors, isRetryableError } from '../errors/index.js';

/**
 * Global UID generator instance for creating unique stream identifiers.
 * This ensures that each stream gets a unique ID across the application.
 */
const uid = new Uid();

/**
 * Stream states for lifecycle management
 */
export enum StreamState {
  /** Stream is idle and ready to accept writes */
  IDLE = 'IDLE',
  /** Stream is actively processing writes */
  ACTIVE = 'ACTIVE',
  /** Stream is draining its buffer */
  DRAINING = 'DRAINING',
  /** Stream is in the process of closing */
  CLOSING = 'CLOSING',
  /** Stream is closed and no longer accepts writes */
  CLOSED = 'CLOSED',
  /** Stream encountered an error */
  ERROR = 'ERROR',
}

/**
 * Write buffer entry
 */
interface WriteBufferEntry {
  chunk: any;
  index: number;
  resolve: () => void;
  reject: (error: Error) => void;
  retryCount: number;
  timestamp: number;
}

/**
 * Stream metrics
 */
export interface StreamMetrics {
  /** Total bytes sent through the stream */
  bytesSent: number;
  /** Total number of packets sent */
  packetsSent: number;
  /** Total number of retry attempts */
  retryCount: number;
  /** Total number of failed writes */
  failedWrites: number;
  /** Current buffer size */
  bufferSize: number;
  /** Current stream state */
  state: StreamState;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum retry attempts per write (default: 3) */
  maxAttempts?: number;
  /** Initial delay between retries in ms (default: 100) */
  initialDelay?: number;
  /** Maximum delay between retries in ms (default: 5000) */
  maxDelay?: number;
  /** Exponential backoff factor (default: 2) */
  backoffFactor?: number;
}

/**
 * Configuration options for creating a NetronWritableStream instance.
 * Browser-compatible version using Web Streams API.
 *
 * @interface NetronWritableStreamOptions
 * @property {any} peer - The remote peer this stream is associated with
 * @property {number} [streamId] - Optional custom stream identifier
 * @property {boolean} [isLive] - Whether the stream is operating in live/real-time mode
 * @property {number} [highWaterMark=16] - Maximum buffer size before backpressure
 * @property {RetryConfig} [retry] - Retry configuration for failed writes
 * @property {(error: Error) => void} [onError] - Error callback handler
 */
export interface NetronWritableStreamOptions {
  peer: any;
  streamId?: number;
  isLive?: boolean;
  highWaterMark?: number;
  retry?: RetryConfig;
  onError?: (error: Error) => void;
}

/**
 * A specialized writable stream implementation for the Netron browser client.
 * This class extends the browser's WritableStream to provide distributed stream capabilities
 * with proper error handling, cleanup, remote peer communication, flow control, and retry logic.
 *
 * Features:
 * - Flow control with configurable high water mark
 * - Automatic retry with exponential backoff
 * - State machine for lifecycle management
 * - Memory management with pending writes tracking
 * - Comprehensive metrics collection
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

  /** Current stream state */
  private state: StreamState = StreamState.IDLE;

  /** Event emitter for stream events */
  private events = new EventEmitter();

  /** Write buffer for flow control */
  private writeBuffer: WriteBufferEntry[] = [];

  /** High water mark for backpressure */
  private readonly highWaterMark: number;

  /** Retry configuration */
  private readonly retryConfig: Required<RetryConfig>;

  /** Error callback handler */
  private readonly errorHandler?: (error: Error) => void;

  /** Stream metrics */
  private metrics: StreamMetrics = {
    bytesSent: 0,
    packetsSent: 0,
    retryCount: 0,
    failedWrites: 0,
    bufferSize: 0,
    state: StreamState.IDLE,
  };

  /** Flag to track if buffer is processing */
  private isProcessing: boolean = false;

  /**
   * Creates a new NetronWritableStream instance.
   *
   * @constructor
   * @param {NetronWritableStreamOptions} options - Configuration options for the stream
   * @param {any} options.peer - The remote peer this stream is associated with
   * @param {number} [options.streamId] - Optional custom stream identifier
   * @param {boolean} [options.isLive=false] - Whether the stream is operating in live mode
   * @param {number} [options.highWaterMark=16] - Maximum buffer size before backpressure
   * @param {RetryConfig} [options.retry] - Retry configuration for failed writes
   * @param {(error: Error) => void} [options.onError] - Error callback handler
   */
  constructor({ peer, streamId, isLive = false, highWaterMark = 16, retry, onError }: NetronWritableStreamOptions) {
    super({
      start: (_controller) => {
        // Controller stored for potential future use
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
    this.highWaterMark = highWaterMark;
    this.errorHandler = onError;

    // Initialize retry configuration with defaults
    this.retryConfig = {
      maxAttempts: retry?.maxAttempts ?? 3,
      initialDelay: retry?.initialDelay ?? 100,
      maxDelay: retry?.maxDelay ?? 5000,
      backoffFactor: retry?.backoffFactor ?? 2,
    };

    if (this.peer.logger) {
      this.peer.logger.info(
        {
          streamId: this.id,
          isLive,
          highWaterMark: this.highWaterMark,
          retryConfig: this.retryConfig,
        },
        'Creating writable stream'
      );
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
   * Implements flow control by buffering writes when at high water mark.
   *
   * @param {any} chunk - The data chunk to write
   * @returns {Promise<void>}
   */
  private async _write(chunk: any): Promise<void> {
    // Check stream state
    if (this.state === StreamState.CLOSED || this.state === StreamState.CLOSING) {
      const error = NetronErrors.streamClosed(String(this.id), 'Attempt to write to closed stream');
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id, state: this.state }, 'Attempt to write to closed stream');
      }
      throw error;
    }

    if (this.state === StreamState.ERROR) {
      const error = NetronErrors.streamError(String(this.id), new Error('Stream is in error state'));
      throw error;
    }

    // Transition to ACTIVE state
    this.transitionState(StreamState.ACTIVE);

    // Add to write buffer
    const entry = await this.enqueueWrite(chunk, this.index++);

    // Process buffer if not already processing
    if (!this.isProcessing) {
      this.processWriteBuffer().catch((err) => {
        if (this.peer.logger) {
          this.peer.logger.error({ streamId: this.id, error: err }, 'Error processing write buffer');
        }
      });
    }

    // Wait for this write to complete
    return entry;
  }

  /**
   * Enqueues a write operation into the buffer.
   * Implements backpressure by emitting drain events.
   *
   * @param {any} chunk - The data chunk to write
   * @param {number} index - The chunk index
   * @returns {Promise<void>}
   */
  private enqueueWrite(chunk: any, index: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry: WriteBufferEntry = {
        chunk,
        index,
        resolve,
        reject,
        retryCount: 0,
        timestamp: Date.now(),
      };

      this.writeBuffer.push(entry);
      this.metrics.bufferSize = this.writeBuffer.length;

      if (this.peer.logger) {
        this.peer.logger.debug(
          { streamId: this.id, index, bufferSize: this.writeBuffer.length },
          'Enqueued write to buffer'
        );
      }
    });
  }

  /**
   * Processes the write buffer, sending chunks to the remote peer.
   * Handles retries and flow control.
   */
  private async processWriteBuffer(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.writeBuffer.length > 0) {
        const entry = this.writeBuffer[0];

        // Safety check for undefined (should never happen)
        if (!entry) {
          this.writeBuffer.shift();
          continue;
        }

        try {
          // Attempt to send the chunk with retry logic
          await this.sendChunkWithRetry(entry);

          // Success - remove from buffer and resolve
          this.writeBuffer.shift();
          this.metrics.bufferSize = this.writeBuffer.length;
          entry.resolve();

          // Update metrics
          this.metrics.packetsSent++;
          const chunkSize = this.estimateChunkSize(entry.chunk);
          this.metrics.bytesSent += chunkSize;

          // Emit drain event if we just went below high water mark
          if (this.writeBuffer.length === this.highWaterMark - 1) {
            this.transitionState(StreamState.DRAINING);
            this.events.emit('drain');

            if (this.peer.logger) {
              this.peer.logger.debug({ streamId: this.id }, 'Buffer draining below high water mark');
            }
          }
        } catch (err: any) {
          // Failed after retries - remove from buffer and reject
          this.writeBuffer.shift();
          this.metrics.bufferSize = this.writeBuffer.length;
          this.metrics.failedWrites++;

          // Transition to error state
          this.transitionState(StreamState.ERROR);

          // Call error handler if provided
          if (this.errorHandler) {
            this.errorHandler(err);
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

          entry.reject(err);

          // Don't continue processing - stream is in error state
          break;
        }
      }

      // If buffer is empty, transition to IDLE
      if (this.writeBuffer.length === 0 && this.state !== StreamState.ERROR) {
        this.transitionState(StreamState.IDLE);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Sends a chunk with retry logic.
   *
   * @param {WriteBufferEntry} entry - The write buffer entry
   * @returns {Promise<void>}
   */
  private async sendChunkWithRetry(entry: WriteBufferEntry): Promise<void> {
    let lastError: Error | undefined;
    let delay = this.retryConfig.initialDelay;

    for (let attempt = 0; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        if (this.peer.logger) {
          this.peer.logger.debug(
            { streamId: this.id, index: entry.index, attempt, retryCount: entry.retryCount },
            'Sending chunk'
          );
        }

        await this.peer.sendStreamChunk(this.id, entry.chunk, entry.index, false, this.isLive);
        return; // Success
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check if error is retryable
        const isRetryable = this.isErrorRetryable(err);

        if (!isRetryable || attempt >= this.retryConfig.maxAttempts) {
          if (this.peer.logger) {
            this.peer.logger.error(
              { streamId: this.id, index: entry.index, attempt, isRetryable },
              'Write failed, not retrying'
            );
          }
          throw lastError;
        }

        // Retry
        entry.retryCount++;
        this.metrics.retryCount++;

        if (this.peer.logger) {
          this.peer.logger.warn(
            { streamId: this.id, index: entry.index, attempt, delay, error: err.message },
            'Write failed, retrying'
          );
        }

        // Emit retry event
        this.events.emit('retry', {
          index: entry.index,
          attempt,
          error: lastError,
          delay,
        });

        // Wait before retry
        await this.delay(delay);

        // Calculate next delay with exponential backoff
        delay = Math.min(delay * this.retryConfig.backoffFactor, this.retryConfig.maxDelay);
      }
    }

    throw lastError;
  }

  /**
   * Determines if an error is retryable.
   *
   * @param {any} error - The error to check
   * @returns {boolean} True if the error is retryable
   */
  private isErrorRetryable(error: any): boolean {
    // Check if error has a code that's retryable
    if (error.code !== undefined) {
      if (typeof error.code === 'number') {
        return isRetryableError(error.code);
      }

      // Network errors are retryable
      if (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ENETUNREACH'
      ) {
        return true;
      }
    }

    // Don't retry programming errors
    if (error instanceof TypeError || error instanceof ReferenceError) {
      return false;
    }

    // Default to retryable for unknown errors
    return true;
  }

  /**
   * Estimates the size of a chunk in bytes.
   *
   * @param {any} chunk - The chunk to estimate
   * @returns {number} Estimated size in bytes
   */
  private estimateChunkSize(chunk: any): number {
    if (chunk === null || chunk === undefined) {
      return 0;
    }

    if (typeof chunk === 'string') {
      return chunk.length * 2; // Approximate UTF-16 size
    }

    if (chunk instanceof ArrayBuffer) {
      return chunk.byteLength;
    }

    if (ArrayBuffer.isView(chunk)) {
      return chunk.byteLength;
    }

    // For objects, use JSON size as estimate
    try {
      return JSON.stringify(chunk).length * 2;
    } catch {
      return 0;
    }
  }

  /**
   * Delays execution for the specified time.
   *
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Internal final implementation for handling stream completion.
   * Waits for all pending writes, then sends final chunk to remote peer and performs cleanup.
   *
   * @returns {Promise<void>}
   */
  private async _final(): Promise<void> {
    if (this.state === StreamState.CLOSED) {
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id }, 'Attempt to finalize closed stream');
      }
      throw NetronErrors.streamClosed(String(this.id), 'Attempt to finalize closed stream');
    }

    // Transition to CLOSING state
    this.transitionState(StreamState.CLOSING);

    if (this.peer.logger) {
      this.peer.logger.debug({ streamId: this.id, index: this.index }, 'Finalizing stream');
    }

    try {
      // Wait for all pending writes to complete
      await this.flush();

      // Send final chunk
      if (this.peer.logger) {
        this.peer.logger.debug({ streamId: this.id, index: this.index }, 'Sending final chunk');
      }
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
    if (this.state === StreamState.CLOSED) {
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id }, 'Attempt to close already closed stream');
      }
      return;
    }

    if (this.peer.logger) {
      this.peer.logger.info({ streamId: this.id, state: this.state }, 'Closing stream');
    }

    // Transition to CLOSED state
    this.transitionState(StreamState.CLOSED);

    // Clear pending writes
    this.clearPendingWrites();

    // Cleanup
    this.cleanup();
  }

  /**
   * Destroys the stream and sends close notification to remote peer.
   * Sends a close notification packet to the remote peer for immediate stream termination.
   *
   * @param {Error} [error] - Optional error that caused the destruction
   */
  public destroy(error?: Error): void {
    if (this.state === StreamState.CLOSED) {
      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id }, 'Attempt to destroy already closed stream');
      }
      return;
    }

    if (this.peer.logger) {
      this.peer.logger.info({ streamId: this.id, error, state: this.state }, 'Destroying stream');
    }

    // Transition to ERROR state if error provided, otherwise CLOSED
    if (error) {
      this.transitionState(StreamState.ERROR);
    } else {
      this.transitionState(StreamState.CLOSED);
    }

    // Clear pending writes
    this.clearPendingWrites(error);

    // Perform cleanup immediately
    this.cleanup();

    if (error) {
      this.events.emit('error', error);

      // Call error handler if provided
      if (this.errorHandler) {
        this.errorHandler(error);
      }
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
   * Transitions the stream to a new state and emits state change event.
   *
   * @param {StreamState} newState - The new state to transition to
   */
  private transitionState(newState: StreamState): void {
    const oldState = this.state;
    if (oldState === newState) {
      return;
    }

    this.state = newState;
    this.metrics.state = newState;

    if (this.peer.logger) {
      this.peer.logger.debug({ streamId: this.id, oldState, newState }, 'Stream state transition');
    }

    this.events.emit('state-change', { oldState, newState });
  }

  /**
   * Clears all pending writes in the buffer.
   *
   * @param {Error} [error] - Optional error to reject pending writes with
   */
  private clearPendingWrites(error?: Error): void {
    const pendingCount = this.writeBuffer.length;

    if (pendingCount > 0) {
      const rejectError = error || new Error('Stream closed with pending writes');

      if (this.peer.logger) {
        this.peer.logger.warn({ streamId: this.id, pendingCount }, 'Clearing pending writes');
      }

      // Reject all pending writes
      for (const entry of this.writeBuffer) {
        entry.reject(rejectError);
      }

      this.writeBuffer = [];
      this.metrics.bufferSize = 0;
    }
  }

  /**
   * Waits for all pending writes to complete.
   * This is useful before closing the stream to ensure all data is sent.
   *
   * @returns {Promise<void>}
   */
  public async flush(): Promise<void> {
    if (this.writeBuffer.length === 0) {
      return;
    }

    if (this.peer.logger) {
      this.peer.logger.debug({ streamId: this.id, pendingWrites: this.writeBuffer.length }, 'Flushing pending writes');
    }

    // Wait for buffer to be empty
    await new Promise<void>((resolve, reject) => {
      const checkBuffer = () => {
        if (this.writeBuffer.length === 0) {
          resolve();
        } else if (this.state === StreamState.ERROR) {
          reject(new Error('Stream in error state during flush'));
        } else {
          // Check again in 10ms
          setTimeout(checkBuffer, 10);
        }
      };

      checkBuffer();
    });
  }

  /**
   * Gets the current stream metrics.
   *
   * @returns {StreamMetrics} Current metrics
   */
  public getMetrics(): StreamMetrics {
    return { ...this.metrics };
  }

  /**
   * Gets the current stream state.
   *
   * @returns {StreamState} Current state
   */
  public getState(): StreamState {
    return this.state;
  }

  /**
   * Checks if the stream can accept writes.
   *
   * @returns {boolean} True if the stream can accept writes
   */
  public isWritable(): boolean {
    return this.state !== StreamState.CLOSED && this.state !== StreamState.CLOSING && this.state !== StreamState.ERROR;
  }

  /**
   * Checks if the buffer is full (at high water mark).
   *
   * @returns {boolean} True if buffer is at or above high water mark
   */
  public isBufferFull(): boolean {
    return this.writeBuffer.length >= this.highWaterMark;
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
