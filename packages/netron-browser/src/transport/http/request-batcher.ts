/**
 * Request Batcher for optimizing HTTP requests
 * Automatically batches multiple requests into single HTTP calls
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import type {
  HttpRequestMessage,
  HttpBatchRequest,
  HttpBatchResponse,
} from './types.js';
import { NetronErrors, Errors } from '../../errors/index.js';

/**
 * Batch request entry with promise resolution
 */
interface BatchEntry {
  request: HttpRequestMessage;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timestamp: number;
  retries?: number;
}

/**
 * Batch configuration options
 */
export interface BatchOptions {
  /** Maximum number of requests per batch (default: 10) */
  maxBatchSize?: number;
  /** Maximum time to wait before sending batch in ms (default: 10) */
  maxBatchWait?: number;
  /** Maximum age of request in queue before sending in ms (default: 100) */
  maxRequestAge?: number;
  /** Enable automatic retrying of failed requests (default: true) */
  enableRetry?: boolean;
  /** Maximum retry attempts (default: 2) */
  maxRetries?: number;
  /** Batch endpoint URL */
  batchEndpoint?: string;
  /** Request headers */
  headers?: Record<string, string>;
}

/**
 * Batch statistics
 */
export interface BatchStatistics {
  totalBatches: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageBatchSize: number;
  averageLatency: number;
  currentQueueSize: number;
  retriedRequests: number;
}

/**
 * Request batcher for optimizing HTTP transport
 * Combines multiple requests into efficient batch calls
 */
export class RequestBatcher extends EventEmitter {
  private queue: BatchEntry[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private ageTimer?: ReturnType<typeof setInterval>;
  private processing = false;
  private batchIdCounter = 0;

  // Configuration
  private readonly maxBatchSize: number;
  private readonly maxBatchWait: number;
  private readonly maxRequestAge: number;
  private readonly enableRetry: boolean;
  private readonly maxRetries: number;
  private readonly batchEndpoint: string;
  private readonly headers: Record<string, string>;

  // Statistics
  private stats: BatchStatistics = {
    totalBatches: 0,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageBatchSize: 0,
    averageLatency: 0,
    currentQueueSize: 0,
    retriedRequests: 0,
  };

  private latencies: number[] = [];
  private batchSizes: number[] = [];

  constructor(
    private baseUrl: string,
    options: BatchOptions = {},
  ) {
    super();

    this.maxBatchSize = options.maxBatchSize || 10;
    this.maxBatchWait = options.maxBatchWait || 10;
    this.maxRequestAge = options.maxRequestAge || 100;
    this.enableRetry = options.enableRetry !== false;
    this.maxRetries = options.maxRetries || 2;
    this.batchEndpoint = options.batchEndpoint || '/netron/batch';
    this.headers = {
      'Content-Type': 'application/json',
      'X-Netron-Version': '2.0',
      ...options.headers,
    };

    // Start age checking timer
    this.startAgeChecker();
  }

  /**
   * Add a request to the batch queue
   */
  async add<T>(request: HttpRequestMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      const entry: BatchEntry = {
        request,
        resolve,
        reject,
        timestamp: Date.now(),
        retries: 0,
      };

      this.queue.push(entry);
      this.stats.currentQueueSize = this.queue.length;

      this.emit('request-queued', {
        requestId: request.id,
        queueSize: this.queue.length,
      });

      // Check if we should flush immediately
      if (this.queue.length >= this.maxBatchSize) {
        this.flush('size-limit');
      } else if (!this.timer) {
        // Start batch timer
        this.timer = setTimeout(() => {
          this.flush('timer');
        }, this.maxBatchWait);
      }
    });
  }

  /**
   * Flush the current batch
   */
  async flush(reason: 'size-limit' | 'timer' | 'age' | 'manual' = 'manual'): Promise<void> {
    // Clear timers
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    // Avoid concurrent flushes
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    // Take up to maxBatchSize items from queue
    const batch = this.queue.splice(0, this.maxBatchSize);
    this.stats.currentQueueSize = this.queue.length;

    // Schedule next batch if there are remaining items
    if (this.queue.length > 0 && !this.timer) {
      this.timer = setTimeout(() => {
        this.flush('timer');
      }, this.maxBatchWait);
    }

    // Process the batch
    await this.processBatch(batch, reason);

    this.processing = false;
  }

  /**
   * Process a batch of requests
   */
  private async processBatch(batch: BatchEntry[], reason: string): Promise<void> {
    const startTime = Date.now();
    const batchId = `batch-${++this.batchIdCounter}`;

    this.emit('batch-start', {
      batchId,
      size: batch.length,
      reason,
    });

    try {
      // Create batch request
      const batchRequest: HttpBatchRequest = {
        id: batchId,
        version: '2.0',
        timestamp: Date.now(),
        requests: batch.map((entry) => ({
          id: entry.request.id,
          service: entry.request.service,
          method: entry.request.method,
          input: entry.request.input,
          context: entry.request.context,
          hints: entry.request.hints,
        })),
        options: {
          parallel: true,
          stopOnError: false,
        },
      };

      // Send batch request
      const response = await fetch(`${this.baseUrl}${this.batchEndpoint}`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(batchRequest),
      });

      if (!response.ok) {
        throw NetronErrors.invalidRequest(
          `Batch request failed: ${response.status} ${response.statusText}`,
          { status: response.status, statusText: response.statusText },
        );
      }

      const batchResponse: HttpBatchResponse = await response.json();

      // Process individual responses
      for (const result of batchResponse.responses) {
        const entry = batch.find((e) => e.request.id === result.id);
        if (!entry) continue;

        if (result.success) {
          entry.resolve(result.data);
          this.stats.successfulRequests++;

          this.emit('request-success', {
            requestId: result.id,
            latency: Date.now() - entry.timestamp,
          });
        } else {
          // Handle failure with potential retry
          if (this.enableRetry && entry.retries! < this.maxRetries) {
            entry.retries!++;
            this.stats.retriedRequests++;

            // Re-queue for retry
            this.queue.push(entry);

            this.emit('request-retry', {
              requestId: result.id,
              attempt: entry.retries,
              error: result.error,
            });
          } else {
            entry.reject(Errors.internal(result.error?.message || 'Request failed'));
            this.stats.failedRequests++;

            this.emit('request-failure', {
              requestId: result.id,
              error: result.error,
            });
          }
        }
      }

      // Update statistics
      const latency = Date.now() - startTime;
      this.updateStatistics(batch.length, latency);

      this.emit('batch-complete', {
        batchId,
        size: batch.length,
        latency,
        successCount: batchResponse.hints?.successCount || 0,
        failureCount: batchResponse.hints?.failureCount || 0,
      });
    } catch (error: any) {
      // Network or other errors - reject all promises in batch
      for (const entry of batch) {
        if (this.enableRetry && entry.retries! < this.maxRetries) {
          entry.retries!++;
          this.stats.retriedRequests++;

          // Re-queue for retry
          this.queue.push(entry);
        } else {
          entry.reject(error);
          this.stats.failedRequests++;
        }
      }

      this.emit('batch-error', {
        batchId,
        size: batch.length,
        error: error.message,
      });
    }
  }

  /**
   * Check for aged requests that should be sent
   */
  private startAgeChecker(): void {
    this.ageTimer = setInterval(() => {
      if (this.queue.length === 0 || this.processing) {
        return;
      }

      const now = Date.now();
      const oldestRequest = this.queue[0];

      if (oldestRequest && now - oldestRequest.timestamp >= this.maxRequestAge) {
        this.flush('age');
      }
    }, Math.min(this.maxRequestAge / 2, 10));
  }

  /**
   * Update batch statistics
   */
  private updateStatistics(batchSize: number, latency: number): void {
    this.stats.totalBatches++;
    this.stats.totalRequests += batchSize;

    // Track batch sizes
    this.batchSizes.push(batchSize);
    if (this.batchSizes.length > 100) {
      this.batchSizes.shift();
    }

    // Track latencies
    this.latencies.push(latency);
    if (this.latencies.length > 100) {
      this.latencies.shift();
    }

    // Calculate averages
    this.stats.averageBatchSize =
      this.batchSizes.reduce((a, b) => a + b, 0) / this.batchSizes.length;

    this.stats.averageLatency = this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
  }

  /**
   * Get current statistics
   */
  getStatistics(): BatchStatistics {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    this.stats = {
      totalBatches: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageBatchSize: 0,
      averageLatency: 0,
      currentQueueSize: this.queue.length,
      retriedRequests: 0,
    };

    this.latencies = [];
    this.batchSizes = [];
  }

  /**
   * Set batch configuration at runtime
   */
  setConfiguration(options: Partial<BatchOptions>): void {
    if (options.maxBatchSize !== undefined) {
      (this as any).maxBatchSize = options.maxBatchSize;
    }
    if (options.maxBatchWait !== undefined) {
      (this as any).maxBatchWait = options.maxBatchWait;
    }
    if (options.maxRequestAge !== undefined) {
      (this as any).maxRequestAge = options.maxRequestAge;
    }
  }

  /**
   * Destroy the batcher and clean up resources
   */
  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.ageTimer) {
      clearInterval(this.ageTimer);
      this.ageTimer = undefined;
    }

    // Reject any pending requests
    for (const entry of this.queue) {
      entry.reject(Errors.unavailable('Request batcher', 'Batcher has been destroyed'));
    }

    this.queue = [];
    this.removeAllListeners();
  }
}
