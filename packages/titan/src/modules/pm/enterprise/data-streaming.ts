/**
 * Data Streaming and CDC Implementation
 *
 * Provides Change Data Capture and stream processing capabilities with:
 * - Stream processing with backpressure handling
 * - Windowing operations (tumbling, sliding, session windows)
 * - Stream transformations (map, filter, reduce, aggregate)
 * - Stream joins (inner, left, right)
 * - Exactly-once/at-least-once delivery semantics
 */

import { EventEmitter } from 'events';
import { Transform, Readable, Writable, pipeline } from 'stream';
import { randomUUID } from 'crypto';

import { Errors } from '../../../errors/index.js';

/**
 * Delivery semantics for stream processing
 */
export type DeliverySemantics = 'at-least-once' | 'exactly-once' | 'at-most-once';

/**
 * Join type for stream operations
 */
export type JoinType = 'inner' | 'left' | 'right' | 'full';

/**
 * Backpressure strategy
 */
export type BackpressureStrategy = 'block' | 'drop' | 'buffer' | 'latest';

/**
 * Change Event
 */
export interface ChangeEvent<T = Record<string, unknown>> {
  id: string;
  source: string;
  table?: string;
  schema?: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE' | 'SNAPSHOT';
  timestamp: number;
  position?: string;
  before?: T;
  after?: T;
  metadata?: Record<string, unknown>;
}

/**
 * Stream Checkpoint
 */
export interface StreamCheckpoint {
  streamId: string;
  position: string;
  timestamp: number;
  offset?: number;
  metadata?: Record<string, any>;
}

/**
 * Stream Configuration
 */
export interface StreamConfig {
  source: string;
  format?: 'json' | 'avro' | 'protobuf' | 'debezium';
  parallelism?: number;
  checkpointing?: string; // e.g., '1m', '30s'
  deliverySemantics?: DeliverySemantics;
  watermark?: WatermarkStrategy;
  windowing?: WindowConfig;
  backpressure?: BackpressureConfig;
}

/**
 * Backpressure Configuration
 */
export interface BackpressureConfig {
  strategy: BackpressureStrategy;
  highWaterMark?: number;
  lowWaterMark?: number;
  bufferSize?: number;
  timeout?: number;
}

/**
 * Watermark Strategy
 */
export interface WatermarkStrategy {
  type: 'periodic' | 'punctuated';
  maxOutOfOrderness?: number;
  idleTimeout?: number;
}

/**
 * Window Configuration
 */
export interface WindowConfig {
  type: 'tumbling' | 'sliding' | 'session';
  size: number;
  slide?: number;
  gap?: number;
}

/**
 * CDC Configuration
 */
export interface CDCConfig {
  source: CDCSource;
  tables?: string[];
  includeSchema?: boolean;
  snapshotMode?: 'initial' | 'never' | 'schema_only';
  format?: string;
  heartbeatInterval?: number;
}

/**
 * CDC Source Configuration
 */
export interface CDCSource {
  type: 'postgres' | 'mysql' | 'mongodb' | 'dynamodb';
  connection: string;
  slot?: string; // For Postgres replication slot
  serverId?: number; // For MySQL binlog
}

/**
 * Stream Element with metadata for tracking
 */
export interface StreamElement<T> {
  id: string;
  value: T;
  timestamp: number;
  key?: string;
  partition?: number;
  offset?: number;
}

/**
 * Aggregation function type
 */
export type AggregateFunction<T, TAcc> = {
  init: () => TAcc;
  add: (acc: TAcc, value: T) => TAcc;
  getResult: (acc: TAcc) => TAcc;
  merge?: (acc1: TAcc, acc2: TAcc) => TAcc;
};

/**
 * Built-in aggregation functions
 */
export const Aggregations = {
  count<T>(): AggregateFunction<T, number> {
    return {
      init: () => 0,
      add: (acc) => acc + 1,
      getResult: (acc) => acc,
      merge: (acc1, acc2) => acc1 + acc2,
    };
  },

  sum(selector?: (value: number) => number): AggregateFunction<number, number> {
    return {
      init: () => 0,
      add: (acc, value) => acc + (selector ? selector(value) : value),
      getResult: (acc) => acc,
      merge: (acc1, acc2) => acc1 + acc2,
    };
  },

  avg(): AggregateFunction<number, { sum: number; count: number }> {
    return {
      init: () => ({ sum: 0, count: 0 }),
      add: (acc, value) => ({ sum: acc.sum + value, count: acc.count + 1 }),
      getResult: (acc) => ({ sum: acc.sum, count: acc.count }),
      merge: (acc1, acc2) => ({ sum: acc1.sum + acc2.sum, count: acc1.count + acc2.count }),
    };
  },

  min(): AggregateFunction<number, number> {
    return {
      init: () => Infinity,
      add: (acc, value) => Math.min(acc, value),
      getResult: (acc) => acc,
      merge: (acc1, acc2) => Math.min(acc1, acc2),
    };
  },

  max(): AggregateFunction<number, number> {
    return {
      init: () => -Infinity,
      add: (acc, value) => Math.max(acc, value),
      getResult: (acc) => acc,
      merge: (acc1, acc2) => Math.max(acc1, acc2),
    };
  },

  collect<T>(): AggregateFunction<T, T[]> {
    return {
      init: () => [],
      add: (acc, value) => [...acc, value],
      getResult: (acc) => acc,
      merge: (acc1, acc2) => [...acc1, ...acc2],
    };
  },
};

/**
 * Stream Processor
 */
export abstract class StreamProcessor<TIn, TOut> {
  protected checkpoints = new Map<string, StreamCheckpoint>();
  protected watermark = 0;
  protected processingTime = Date.now();
  protected processedIds = new Set<string>();
  protected deliverySemantics: DeliverySemantics = 'at-least-once';

  /**
   * Process a single element
   */
  abstract process(element: TIn, context: ProcessContext): Promise<TOut | null>;

  /**
   * Set delivery semantics
   */
  setDeliverySemantics(semantics: DeliverySemantics): void {
    this.deliverySemantics = semantics;
  }

  /**
   * Process with exactly-once semantics
   */
  async processExactlyOnce(element: TIn, context: ProcessContext): Promise<TOut | null> {
    const elementId = this.getElementId(element);

    // Check if already processed (idempotent check)
    if (this.processedIds.has(elementId)) {
      return null;
    }

    const checkpoint = this.getCheckpoint(context.streamId);

    // Check if position is already processed
    if (checkpoint && context.offset !== undefined && context.offset <= (checkpoint.offset ?? -1)) {
      return null;
    }

    const result = await this.process(element, context);

    // Mark as processed
    this.processedIds.add(elementId);

    // Update checkpoint
    await this.checkpoint(context);

    // Cleanup old processed IDs (keep last 10000)
    if (this.processedIds.size > 10000) {
      const idsArray = Array.from(this.processedIds);
      this.processedIds = new Set(idsArray.slice(-5000));
    }

    return result;
  }

  /**
   * Process with at-least-once semantics
   */
  async processAtLeastOnce(element: TIn, context: ProcessContext): Promise<TOut | null> {
    const result = await this.process(element, context);
    await this.checkpoint(context);
    return result;
  }

  /**
   * Process with configured semantics
   */
  async processWithSemantics(element: TIn, context: ProcessContext): Promise<TOut | null> {
    switch (this.deliverySemantics) {
      case 'exactly-once':
        return this.processExactlyOnce(element, context);
      case 'at-least-once':
        return this.processAtLeastOnce(element, context);
      case 'at-most-once':
        // Process without waiting for checkpoint
        const result = await this.process(element, context);
        // Fire and forget checkpoint
        this.checkpoint(context).catch(() => {});
        return result;
      default:
        return this.process(element, context);
    }
  }

  /**
   * Get element ID for deduplication
   */
  protected getElementId(element: TIn): string {
    if (typeof element === 'object' && element !== null && 'id' in element) {
      return String((element as Record<string, unknown>)['id']);
    }
    return JSON.stringify(element);
  }

  /**
   * Check if element is duplicate
   */
  protected isDuplicate(element: TIn, checkpoint: StreamCheckpoint): boolean {
    const elementId = this.getElementId(element);
    return this.processedIds.has(elementId);
  }

  /**
   * Create checkpoint
   */
  protected async checkpoint(context: ProcessContext): Promise<void> {
    const checkpoint: StreamCheckpoint = {
      streamId: context.streamId,
      position: context.position || '',
      timestamp: Date.now(),
      offset: context.offset,
    };

    this.checkpoints.set(context.streamId, checkpoint);
  }

  /**
   * Get checkpoint
   */
  protected getCheckpoint(streamId: string): StreamCheckpoint | undefined {
    return this.checkpoints.get(streamId);
  }

  /**
   * Get all checkpoints
   */
  getCheckpoints(): Map<string, StreamCheckpoint> {
    return new Map(this.checkpoints);
  }

  /**
   * Restore from checkpoint
   */
  restoreFromCheckpoint(checkpoint: StreamCheckpoint): void {
    this.checkpoints.set(checkpoint.streamId, checkpoint);
  }

  /**
   * Update watermark
   */
  protected updateWatermark(timestamp: number): void {
    if (timestamp > this.watermark) {
      this.watermark = timestamp;
    }
  }

  /**
   * Get current watermark
   */
  getWatermark(): number {
    return this.watermark;
  }
}

/**
 * Process Context
 */
export interface ProcessContext {
  streamId: string;
  position?: string;
  offset?: number;
  timestamp: number;
  watermark: number;
  window?: Window;
}

/**
 * Window
 */
export interface Window {
  start: number;
  end: number;
  key?: string;
}

/**
 * Window result with metadata
 */
export interface WindowResult<T> {
  window: Window;
  elements: T[];
  timestamp: number;
  watermark: number;
}

/**
 * Session window state
 */
interface SessionState<T> {
  elements: T[];
  lastActivity: number;
  window: Window;
}

/**
 * Window Manager - handles all windowing operations
 */
export class WindowManager<T> extends EventEmitter {
  private tumblingWindows = new Map<string, T[]>();
  private slidingWindows = new Map<string, { elements: T[]; timestamps: number[] }>();
  private sessionWindows = new Map<string, SessionState<T>>();
  private windowTimers = new Map<string, NodeJS.Timeout>();
  private watermark = 0;
  private config: WindowConfig;
  private keyExtractor: (element: T) => string;

  constructor(
    config: WindowConfig,
    keyExtractor: (element: T) => string = () => '__default__'
  ) {
    super();
    this.config = config;
    this.keyExtractor = keyExtractor;
  }

  /**
   * Add element to appropriate window(s)
   */
  add(element: T, timestamp: number = Date.now()): WindowResult<T>[] {
    this.updateWatermark(timestamp);
    const key = this.keyExtractor(element);

    switch (this.config.type) {
      case 'tumbling':
        return this.addToTumblingWindow(element, timestamp, key);
      case 'sliding':
        return this.addToSlidingWindow(element, timestamp, key);
      case 'session':
        return this.addToSessionWindow(element, timestamp, key);
      default:
        throw Errors.badRequest(`Unknown window type: ${this.config.type}`);
    }
  }

  /**
   * Add element to tumbling window
   */
  private addToTumblingWindow(element: T, timestamp: number, key: string): WindowResult<T>[] {
    const windowStart = Math.floor(timestamp / this.config.size) * this.config.size;
    const windowEnd = windowStart + this.config.size;
    const windowKey = `${key}:${windowStart}`;

    let window = this.tumblingWindows.get(windowKey);
    if (!window) {
      window = [];
      this.tumblingWindows.set(windowKey, window);

      // Set timer to close window
      const delay = windowEnd - timestamp;
      const timer = setTimeout(() => {
        this.closeTumblingWindow(windowKey, windowStart, windowEnd, key);
      }, delay);
      this.windowTimers.set(windowKey, timer);
    }

    window.push(element);

    // Check if window should close based on watermark
    const results: WindowResult<T>[] = [];
    if (this.watermark >= windowEnd) {
      const result = this.closeTumblingWindow(windowKey, windowStart, windowEnd, key);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Close tumbling window and emit result
   */
  private closeTumblingWindow(
    windowKey: string,
    windowStart: number,
    windowEnd: number,
    key: string
  ): WindowResult<T> | null {
    const elements = this.tumblingWindows.get(windowKey);
    if (!elements || elements.length === 0) {
      return null;
    }

    this.tumblingWindows.delete(windowKey);

    const timer = this.windowTimers.get(windowKey);
    if (timer) {
      clearTimeout(timer);
      this.windowTimers.delete(windowKey);
    }

    const result: WindowResult<T> = {
      window: { start: windowStart, end: windowEnd, key },
      elements: [...elements],
      timestamp: Date.now(),
      watermark: this.watermark,
    };

    this.emit('window:closed', result);
    return result;
  }

  /**
   * Add element to sliding window
   */
  private addToSlidingWindow(element: T, timestamp: number, key: string): WindowResult<T>[] {
    const results: WindowResult<T>[] = [];
    const slide = this.config.slide || this.config.size;

    // Determine all windows this element belongs to
    const windowCount = Math.ceil(this.config.size / slide);

    for (let i = 0; i < windowCount; i++) {
      const slideOffset = i * slide;
      const windowStart = Math.floor((timestamp - slideOffset) / slide) * slide;
      const windowEnd = windowStart + this.config.size;

      // Only add if timestamp falls within window
      if (timestamp >= windowStart && timestamp < windowEnd) {
        const windowKey = `${key}:${windowStart}`;

        let windowData = this.slidingWindows.get(windowKey);
        if (!windowData) {
          windowData = { elements: [], timestamps: [] };
          this.slidingWindows.set(windowKey, windowData);

          // Set timer to close window
          const delay = windowEnd - timestamp;
          if (delay > 0) {
            const timer = setTimeout(() => {
              const result = this.closeSlidingWindow(windowKey, windowStart, windowEnd, key);
              if (result) {
                results.push(result);
              }
            }, delay);
            this.windowTimers.set(windowKey, timer);
          }
        }

        windowData.elements.push(element);
        windowData.timestamps.push(timestamp);
      }
    }

    // Check for windows to close based on watermark
    for (const [wKey, _windowData] of this.slidingWindows.entries()) {
      const parts = wKey.split(':');
      const keyPart = parts[0];
      const startStr = parts[1] ?? '0';
      if (keyPart === key) {
        const windowStart = parseInt(startStr, 10);
        const windowEnd = windowStart + this.config.size;
        if (this.watermark >= windowEnd) {
          const result = this.closeSlidingWindow(wKey, windowStart, windowEnd, key);
          if (result) {
            results.push(result);
          }
        }
      }
    }

    return results;
  }

  /**
   * Close sliding window
   */
  private closeSlidingWindow(
    windowKey: string,
    windowStart: number,
    windowEnd: number,
    key: string
  ): WindowResult<T> | null {
    const windowData = this.slidingWindows.get(windowKey);
    if (!windowData || windowData.elements.length === 0) {
      return null;
    }

    this.slidingWindows.delete(windowKey);

    const timer = this.windowTimers.get(windowKey);
    if (timer) {
      clearTimeout(timer);
      this.windowTimers.delete(windowKey);
    }

    const result: WindowResult<T> = {
      window: { start: windowStart, end: windowEnd, key },
      elements: [...windowData.elements],
      timestamp: Date.now(),
      watermark: this.watermark,
    };

    this.emit('window:closed', result);
    return result;
  }

  /**
   * Add element to session window
   */
  private addToSessionWindow(element: T, timestamp: number, key: string): WindowResult<T>[] {
    const results: WindowResult<T>[] = [];
    const gap = this.config.gap || 60000; // Default 1 minute gap

    let session = this.sessionWindows.get(key);

    if (!session) {
      // Create new session
      session = {
        elements: [],
        lastActivity: timestamp,
        window: { start: timestamp, end: timestamp + gap, key },
      };
      this.sessionWindows.set(key, session);
    } else {
      // Check if within session gap
      const timeSinceLastActivity = timestamp - session.lastActivity;
      if (timeSinceLastActivity > gap) {
        // Close current session and start new one
        const closedResult = this.closeSessionWindow(key, session);
        if (closedResult) {
          results.push(closedResult);
        }

        // Create new session
        session = {
          elements: [],
          lastActivity: timestamp,
          window: { start: timestamp, end: timestamp + gap, key },
        };
        this.sessionWindows.set(key, session);
      } else {
        // Extend session
        session.lastActivity = timestamp;
        session.window.end = timestamp + gap;
      }
    }

    session.elements.push(element);

    // Set/reset timer for session timeout
    const existingTimer = this.windowTimers.get(`session:${key}`);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      const currentSession = this.sessionWindows.get(key);
      if (currentSession && Date.now() - currentSession.lastActivity >= gap) {
        const result = this.closeSessionWindow(key, currentSession);
        if (result) {
          this.emit('window:closed', result);
        }
      }
    }, gap);
    this.windowTimers.set(`session:${key}`, timer);

    return results;
  }

  /**
   * Close session window
   */
  private closeSessionWindow(key: string, session: SessionState<T>): WindowResult<T> | null {
    if (!session || session.elements.length === 0) {
      return null;
    }

    this.sessionWindows.delete(key);

    const timer = this.windowTimers.get(`session:${key}`);
    if (timer) {
      clearTimeout(timer);
      this.windowTimers.delete(`session:${key}`);
    }

    return {
      window: { ...session.window },
      elements: [...session.elements],
      timestamp: Date.now(),
      watermark: this.watermark,
    };
  }

  /**
   * Update watermark
   */
  private updateWatermark(timestamp: number): void {
    if (timestamp > this.watermark) {
      this.watermark = timestamp;
    }
  }

  /**
   * Get current watermark
   */
  getWatermark(): number {
    return this.watermark;
  }

  /**
   * Force close all windows
   */
  closeAll(): WindowResult<T>[] {
    const results: WindowResult<T>[] = [];

    // Close tumbling windows
    for (const [windowKey, elements] of this.tumblingWindows.entries()) {
      const parts = windowKey.split(':');
      const key = parts[0];
      const startStr = parts[1] ?? '0';
      const windowStart = parseInt(startStr, 10);
      const windowEnd = windowStart + this.config.size;
      results.push({
        window: { start: windowStart, end: windowEnd, key },
        elements: [...elements],
        timestamp: Date.now(),
        watermark: this.watermark,
      });
    }
    this.tumblingWindows.clear();

    // Close sliding windows
    for (const [windowKey, windowData] of this.slidingWindows.entries()) {
      const parts = windowKey.split(':');
      const key = parts[0];
      const startStr = parts[1] ?? '0';
      const windowStart = parseInt(startStr, 10);
      const windowEnd = windowStart + this.config.size;
      results.push({
        window: { start: windowStart, end: windowEnd, key },
        elements: [...windowData.elements],
        timestamp: Date.now(),
        watermark: this.watermark,
      });
    }
    this.slidingWindows.clear();

    // Close session windows
    for (const [_key, session] of this.sessionWindows.entries()) {
      results.push({
        window: { ...session.window },
        elements: [...session.elements],
        timestamp: Date.now(),
        watermark: this.watermark,
      });
    }
    this.sessionWindows.clear();

    // Clear all timers
    for (const timer of this.windowTimers.values()) {
      clearTimeout(timer);
    }
    this.windowTimers.clear();

    return results;
  }

  /**
   * Get statistics
   */
  getStats(): {
    activeWindows: number;
    tumblingWindows: number;
    slidingWindows: number;
    sessionWindows: number;
    watermark: number;
  } {
    return {
      activeWindows:
        this.tumblingWindows.size + this.slidingWindows.size + this.sessionWindows.size,
      tumblingWindows: this.tumblingWindows.size,
      slidingWindows: this.slidingWindows.size,
      sessionWindows: this.sessionWindows.size,
      watermark: this.watermark,
    };
  }
}

/**
 * Backpressure Handler for stream processing
 */
export class BackpressureHandler<T> extends EventEmitter {
  private buffer: T[] = [];
  private paused = false;
  private dropped = 0;
  private config: BackpressureConfig;

  constructor(config: BackpressureConfig) {
    super();
    this.config = {
      strategy: config.strategy,
      highWaterMark: config.highWaterMark ?? 1000,
      lowWaterMark: config.lowWaterMark ?? 100,
      bufferSize: config.bufferSize ?? 10000,
      timeout: config.timeout ?? 30000,
    };
  }

  /**
   * Try to push an element
   */
  async push(element: T): Promise<boolean> {
    if (this.buffer.length >= this.config.bufferSize!) {
      switch (this.config.strategy) {
        case 'drop':
          this.dropped++;
          this.emit('dropped', { element, totalDropped: this.dropped });
          return false;

        case 'latest':
          // Drop oldest, keep latest
          this.buffer.shift();
          this.dropped++;
          this.buffer.push(element);
          this.emit('dropped', { element: 'oldest', totalDropped: this.dropped });
          return true;

        case 'block':
          // Wait for buffer to drain
          const drained = await this.waitForDrain();
          if (!drained) {
            this.emit('timeout', { bufferSize: this.buffer.length });
            return false;
          }
          break;

        case 'buffer':
        default:
          // Just add to buffer (unbounded)
          break;
      }
    }

    this.buffer.push(element);

    // Check high water mark
    if (this.buffer.length >= this.config.highWaterMark! && !this.paused) {
      this.paused = true;
      this.emit('pause');
    }

    return true;
  }

  /**
   * Pull an element from buffer
   */
  pull(): T | undefined {
    const element = this.buffer.shift();

    // Check low water mark
    if (this.paused && this.buffer.length <= this.config.lowWaterMark!) {
      this.paused = false;
      this.emit('resume');
    }

    return element;
  }

  /**
   * Pull multiple elements
   */
  pullBatch(count: number): T[] {
    const batch = this.buffer.splice(0, count);

    // Check low water mark
    if (this.paused && this.buffer.length <= this.config.lowWaterMark!) {
      this.paused = false;
      this.emit('resume');
    }

    return batch;
  }

  /**
   * Wait for buffer to drain below high water mark
   */
  private async waitForDrain(): Promise<boolean> {
    if (this.buffer.length < this.config.highWaterMark!) {
      return true;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, this.config.timeout);

      const checkDrain = () => {
        if (this.buffer.length < this.config.highWaterMark!) {
          clearTimeout(timeout);
          resolve(true);
        } else {
          setTimeout(checkDrain, 10);
        }
      };

      checkDrain();
    });
  }

  /**
   * Check if paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Get buffer size
   */
  size(): number {
    return this.buffer.length;
  }

  /**
   * Get dropped count
   */
  getDroppedCount(): number {
    return this.dropped;
  }

  /**
   * Clear buffer
   */
  clear(): void {
    this.buffer = [];
    this.paused = false;
    this.emit('resume');
  }

  /**
   * Get statistics
   */
  getStats(): {
    bufferSize: number;
    paused: boolean;
    dropped: number;
    highWaterMark: number;
    lowWaterMark: number;
  } {
    return {
      bufferSize: this.buffer.length,
      paused: this.paused,
      dropped: this.dropped,
      highWaterMark: this.config.highWaterMark!,
      lowWaterMark: this.config.lowWaterMark!,
    };
  }
}

/**
 * Stream Join Configuration
 */
export interface StreamJoinConfig<TLeft, TRight> {
  type: JoinType;
  leftKeyExtractor: (element: TLeft) => string;
  rightKeyExtractor: (element: TRight) => string;
  windowSize?: number;
  windowSlide?: number;
}

/**
 * Stream Join Result
 */
export interface JoinResult<TLeft, TRight> {
  left: TLeft | null;
  right: TRight | null;
  key: string;
  timestamp: number;
}

/**
 * Stream Joiner - handles stream join operations
 */
export class StreamJoiner<TLeft, TRight> extends EventEmitter {
  private leftBuffer = new Map<string, { elements: TLeft[]; timestamps: number[] }>();
  private rightBuffer = new Map<string, { elements: TRight[]; timestamps: number[] }>();
  private config: StreamJoinConfig<TLeft, TRight>;
  private watermark = 0;

  constructor(config: StreamJoinConfig<TLeft, TRight>) {
    super();
    this.config = {
      ...config,
      windowSize: config.windowSize ?? 60000, // Default 1 minute
    };
  }

  /**
   * Add element from left stream
   */
  addLeft(element: TLeft, timestamp: number = Date.now()): JoinResult<TLeft, TRight>[] {
    this.updateWatermark(timestamp);
    const key = this.config.leftKeyExtractor(element);

    // Store in left buffer
    let buffer = this.leftBuffer.get(key);
    if (!buffer) {
      buffer = { elements: [], timestamps: [] };
      this.leftBuffer.set(key, buffer);
    }
    buffer.elements.push(element);
    buffer.timestamps.push(timestamp);

    // Clean expired entries
    this.cleanExpired(timestamp);

    // Perform join
    return this.performJoin(element, key, timestamp, 'left');
  }

  /**
   * Add element from right stream
   */
  addRight(element: TRight, timestamp: number = Date.now()): JoinResult<TLeft, TRight>[] {
    this.updateWatermark(timestamp);
    const key = this.config.rightKeyExtractor(element);

    // Store in right buffer
    let buffer = this.rightBuffer.get(key);
    if (!buffer) {
      buffer = { elements: [], timestamps: [] };
      this.rightBuffer.set(key, buffer);
    }
    buffer.elements.push(element);
    buffer.timestamps.push(timestamp);

    // Clean expired entries
    this.cleanExpired(timestamp);

    // Perform join
    return this.performJoin(element, key, timestamp, 'right');
  }

  /**
   * Perform join operation
   */
  private performJoin(
    element: TLeft | TRight,
    key: string,
    timestamp: number,
    side: 'left' | 'right'
  ): JoinResult<TLeft, TRight>[] {
    const results: JoinResult<TLeft, TRight>[] = [];

    if (side === 'left') {
      const leftElement = element as TLeft;
      const rightBuffer = this.rightBuffer.get(key);

      if (rightBuffer && rightBuffer.elements.length > 0) {
        // Inner join or left join - emit for each matching right element
        for (const rightElement of rightBuffer.elements) {
          results.push({
            left: leftElement,
            right: rightElement,
            key,
            timestamp,
          });
        }
      } else if (this.config.type === 'left' || this.config.type === 'full') {
        // Left or full outer join - emit with null right
        results.push({
          left: leftElement,
          right: null,
          key,
          timestamp,
        });
      }
    } else {
      const rightElement = element as TRight;
      const leftBuffer = this.leftBuffer.get(key);

      if (leftBuffer && leftBuffer.elements.length > 0) {
        // Inner join or right join - emit for each matching left element
        for (const leftElement of leftBuffer.elements) {
          results.push({
            left: leftElement,
            right: rightElement,
            key,
            timestamp,
          });
        }
      } else if (this.config.type === 'right' || this.config.type === 'full') {
        // Right or full outer join - emit with null left
        results.push({
          left: null,
          right: rightElement,
          key,
          timestamp,
        });
      }
    }

    for (const result of results) {
      this.emit('joined', result);
    }

    return results;
  }

  /**
   * Clean expired entries from buffers
   */
  private cleanExpired(currentTimestamp: number): void {
    const windowSize = this.config.windowSize!;

    for (const [key, buffer] of this.leftBuffer.entries()) {
      const validElements: TLeft[] = [];
      const validTimestamps: number[] = [];
      for (let i = 0; i < buffer.timestamps.length; i++) {
        const ts = buffer.timestamps[i];
        const elem = buffer.elements[i];
        if (ts !== undefined && elem !== undefined && currentTimestamp - ts < windowSize) {
          validElements.push(elem);
          validTimestamps.push(ts);
        }
      }
      buffer.elements = validElements;
      buffer.timestamps = validTimestamps;

      if (buffer.elements.length === 0) {
        this.leftBuffer.delete(key);
      }
    }

    for (const [key, buffer] of this.rightBuffer.entries()) {
      const validElements: TRight[] = [];
      const validTimestamps: number[] = [];
      for (let i = 0; i < buffer.timestamps.length; i++) {
        const ts = buffer.timestamps[i];
        const elem = buffer.elements[i];
        if (ts !== undefined && elem !== undefined && currentTimestamp - ts < windowSize) {
          validElements.push(elem);
          validTimestamps.push(ts);
        }
      }
      buffer.elements = validElements;
      buffer.timestamps = validTimestamps;

      if (buffer.elements.length === 0) {
        this.rightBuffer.delete(key);
      }
    }
  }

  /**
   * Update watermark
   */
  private updateWatermark(timestamp: number): void {
    if (timestamp > this.watermark) {
      this.watermark = timestamp;
    }
  }

  /**
   * Get current watermark
   */
  getWatermark(): number {
    return this.watermark;
  }

  /**
   * Get statistics
   */
  getStats(): {
    leftBufferSize: number;
    rightBufferSize: number;
    leftKeys: number;
    rightKeys: number;
    watermark: number;
  } {
    let leftTotal = 0;
    for (const buffer of this.leftBuffer.values()) {
      leftTotal += buffer.elements.length;
    }

    let rightTotal = 0;
    for (const buffer of this.rightBuffer.values()) {
      rightTotal += buffer.elements.length;
    }

    return {
      leftBufferSize: leftTotal,
      rightBufferSize: rightTotal,
      leftKeys: this.leftBuffer.size,
      rightKeys: this.rightBuffer.size,
      watermark: this.watermark,
    };
  }

  /**
   * Clear all buffers
   */
  clear(): void {
    this.leftBuffer.clear();
    this.rightBuffer.clear();
  }
}

/**
 * CDC Connector
 */
export class CDCConnector extends EventEmitter {
  private running = false;
  private position?: string;
  private snapshotComplete = false;
  private changes: ChangeEvent[] = [];
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(private config: CDCConfig) {
    super();
  }

  /**
   * Start CDC
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.emit('cdc:started', { source: this.config.source.type });

    // Start with snapshot if configured
    if (this.config.snapshotMode === 'initial') {
      await this.performSnapshot();
    }

    // Start streaming changes
    this.streamChanges();

    // Start heartbeat if configured
    if (this.config.heartbeatInterval) {
      this.startHeartbeat();
    }
  }

  /**
   * Stop CDC
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    this.emit('cdc:stopped');
  }

  /**
   * Perform initial snapshot
   */
  private async performSnapshot(): Promise<void> {
    this.emit('snapshot:started');

    // Simulate snapshot of tables
    for (const table of this.config.tables || []) {
      // In production, would query actual database
      const rows = await this.fetchTableData(table);

      for (const row of rows) {
        const event: ChangeEvent = {
          id: randomUUID(),
          source: this.config.source.type,
          table,
          op: 'SNAPSHOT',
          timestamp: Date.now(),
          after: row,
        };

        this.emit('change', event);
        this.changes.push(event);
      }
    }

    this.snapshotComplete = true;
    this.emit('snapshot:completed');
  }

  /**
   * Stream changes
   */
  private async streamChanges(): Promise<void> {
    while (this.running) {
      try {
        const changes = await this.fetchChanges();

        for (const change of changes) {
          const event = this.transformChange(change);
          this.emit('change', event);
          this.changes.push(event);
          this.position = event.position;
        }

        // Wait before next poll
        await this.delay(100);
      } catch (error) {
        this.emit('error', error);
        await this.delay(5000); // Back off on error
      }
    }
  }

  /**
   * Fetch table data (simulated)
   */
  private async fetchTableData(table: string): Promise<any[]> {
    // Simulate fetching data
    return Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      table,
      data: `snapshot-${i}`,
    }));
  }

  /**
   * Fetch changes (simulated)
   */
  private async fetchChanges(): Promise<any[]> {
    // Simulate change events
    if (Math.random() > 0.7) {
      return [
        {
          type: ['INSERT', 'UPDATE', 'DELETE'][Math.floor(Math.random() * 3)],
          table: this.config.tables?.[0] || 'table1',
          data: { id: Date.now(), value: Math.random() },
        },
      ];
    }
    return [];
  }

  /**
   * Transform change to standard format
   */
  private transformChange(change: any): ChangeEvent {
    return {
      id: randomUUID(),
      source: this.config.source.type,
      table: change.table,
      op: change.type,
      timestamp: Date.now(),
      position: `${Date.now()}`,
      before: change.type === 'UPDATE' ? change.before : undefined,
      after: change.type !== 'DELETE' ? change.data : undefined,
    };
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.running) {
        this.emit('heartbeat', {
          position: this.position,
          timestamp: Date.now(),
        });
      }
    }, this.config.heartbeatInterval!);
  }

  /**
   * Get current position
   */
  getPosition(): string | undefined {
    return this.position;
  }

  /**
   * Seek to position
   */
  async seek(position: string): Promise<void> {
    this.position = position;
    this.emit('seek', { position });
  }

  /**
   * Get buffered changes
   */
  getChanges(): ChangeEvent[] {
    return [...this.changes];
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Stream Pipeline Builder
 */
export class StreamPipeline<T> {
  private stages: StreamStage[] = [];
  private source?: StreamSource<T>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sink?: StreamSink<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private backpressureHandler?: BackpressureHandler<any>;
  private windowManager?: WindowManager<T>;

  /**
   * Set source
   */
  from(source: StreamSource<T>): this {
    this.source = source;
    return this;
  }

  /**
   * Configure backpressure handling
   */
  withBackpressure(config: BackpressureConfig): this {
    this.backpressureHandler = new BackpressureHandler(config);
    return this;
  }

  /**
   * Add transformation
   */
  transform<TOut>(processor: (input: T) => TOut | Promise<TOut>): StreamPipeline<TOut> {
    this.stages.push({
      type: 'transform',
      processor,
    });
    return this as unknown as StreamPipeline<TOut>;
  }

  /**
   * Add filter
   */
  filter(predicate: (input: T) => boolean | Promise<boolean>): this {
    this.stages.push({
      type: 'filter',
      processor: async (input: T) => {
        const passes = await predicate(input);
        return passes ? input : null;
      },
    });
    return this;
  }

  /**
   * Add map operation
   */
  map<TOut>(mapper: (input: T) => TOut | Promise<TOut>): StreamPipeline<TOut> {
    this.stages.push({
      type: 'map',
      processor: mapper,
    });
    return this as unknown as StreamPipeline<TOut>;
  }

  /**
   * Add flatMap operation
   */
  flatMap<TOut>(mapper: (input: T) => TOut[] | AsyncIterable<TOut>): StreamPipeline<TOut> {
    this.stages.push({
      type: 'flatMap',
      processor: mapper,
    });
    return this as unknown as StreamPipeline<TOut>;
  }

  /**
   * Add reduce operation
   */
  reduce<TAcc>(reducer: (acc: TAcc, input: T) => TAcc, initial: TAcc): StreamPipeline<TAcc> {
    let accumulator = initial;
    this.stages.push({
      type: 'reduce',
      processor: (input: T) => {
        accumulator = reducer(accumulator, input);
        return accumulator;
      },
    });
    return this as unknown as StreamPipeline<TAcc>;
  }

  /**
   * Add aggregate operation with custom aggregation function
   */
  aggregate<TAcc>(
    aggregator: AggregateFunction<T, TAcc>,
    keyExtractor?: (input: T) => string
  ): StreamPipeline<{ key: string; value: TAcc }> {
    const accumulators = new Map<string, TAcc>();

    this.stages.push({
      type: 'aggregate',
      processor: (input: T) => {
        const key = keyExtractor ? keyExtractor(input) : '__default__';
        let acc = accumulators.get(key);
        if (acc === undefined) {
          acc = aggregator.init();
        }
        acc = aggregator.add(acc, input);
        accumulators.set(key, acc);
        return { key, value: aggregator.getResult(acc) };
      },
    });

    return this as unknown as StreamPipeline<{ key: string; value: TAcc }>;
  }

  /**
   * Add window operation
   */
  window(config: WindowConfig, keyExtractor?: (element: T) => string): StreamPipeline<WindowResult<T>> {
    this.windowManager = new WindowManager<T>(config, keyExtractor);
    const windowManager = this.windowManager;

    this.stages.push({
      type: 'window',
      processor: (input: T) => {
        const results = windowManager.add(input);
        // Return results if any windows closed
        return results.length > 0 ? results : null;
      },
    });

    return this as unknown as StreamPipeline<WindowResult<T>>;
  }

  /**
   * Add join operation
   */
  join<TOther, TOut>(
    other: StreamSource<TOther>,
    joiner: (left: T, right: TOther) => TOut,
    keyExtractor?: (input: T | TOther) => string
  ): StreamPipeline<TOut> {
    const leftBuffer = new Map<string, T[]>();
    const rightBuffer = new Map<string, TOther[]>();

    // Start consuming from right stream
    const rightStream = other.createStream();
    rightStream.on('data', (rightInput: TOther) => {
      const k = keyExtractor ? keyExtractor(rightInput) : JSON.stringify(rightInput);
      const buffer = rightBuffer.get(k) || [];
      buffer.push(rightInput);
      rightBuffer.set(k, buffer);
    });

    this.stages.push({
      type: 'join',
      processor: (input: T) => {
        const k = keyExtractor ? keyExtractor(input) : JSON.stringify(input);

        // Store in left buffer
        const leftBuf = leftBuffer.get(k) || [];
        leftBuf.push(input);
        leftBuffer.set(k, leftBuf);

        // Check for matching right side
        const rightBuf = rightBuffer.get(k);
        if (rightBuf && rightBuf.length > 0) {
          // Return all matches
          return rightBuf.map((right) => joiner(input, right));
        }

        return null;
      },
    });

    return this as unknown as StreamPipeline<TOut>;
  }

  /**
   * Set sink
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  to(sink: StreamSink<any>): this {
    this.sink = sink;
    return this;
  }

  /**
   * Get window manager (for testing/inspection)
   */
  getWindowManager(): WindowManager<T> | undefined {
    return this.windowManager;
  }

  /**
   * Get backpressure handler (for testing/inspection)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getBackpressureHandler(): BackpressureHandler<any> | undefined {
    return this.backpressureHandler;
  }

  /**
   * Execute pipeline
   */
  async execute(): Promise<void> {
    if (!this.source) {
      throw Errors.notFound('No source configured');
    }

    if (!this.sink) {
      throw Errors.notFound('No sink configured');
    }

    // Create node streams
    const sourceStream = this.source.createStream();
    const sinkStream = this.sink.createStream();

    // Create transform streams for stages
    const transforms = this.stages.map((stage) => this.createTransform(stage));

    // Build pipeline
    const streams = [sourceStream, ...transforms, sinkStream];
    await new Promise((resolve, reject) => {
      (pipeline as any)(...streams, (err: Error | null) => {
        if (err) reject(err);
        else resolve(undefined);
      });
    });
  }

  /**
   * Create transform stream for stage
   */
  private createTransform(stage: StreamStage): Transform {
    return new Transform({
      objectMode: true,
      async transform(chunk, encoding, callback) {
        try {
          const result = await stage.processor(chunk);
          if (result !== null && result !== undefined) {
            if (stage.type === 'flatMap' && Symbol.asyncIterator in Object(result)) {
              for await (const item of result as AsyncIterable<unknown>) {
                this.push(item);
              }
            } else if ((stage.type === 'flatMap' || stage.type === 'window' || stage.type === 'join') && Array.isArray(result)) {
              for (const item of result) {
                this.push(item);
              }
            } else {
              this.push(result);
            }
          }
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
    });
  }

  /**
   * Get window key
   */
  private getWindowKey(timestamp: number, config: WindowConfig): string {
    const windowStart = Math.floor(timestamp / config.size) * config.size;
    return `${windowStart}-${windowStart + config.size}`;
  }

  /**
   * Check if window is complete
   */
  private isWindowComplete(windowKey: string, config: WindowConfig): boolean {
    const [start, end] = windowKey.split('-').map(Number);
    return Date.now() > (end || 0);
  }
}

/**
 * Stream Stage
 */
interface StreamStage {
  type: 'transform' | 'filter' | 'map' | 'flatMap' | 'reduce' | 'window' | 'join' | 'aggregate';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processor: (input: any) => any;
}

/**
 * Stream Source
 */
export interface StreamSource<T> {
  createStream(): Readable;
}

/**
 * Stream Sink
 */
export interface StreamSink<T> {
  createStream(): Writable;
}

/**
 * Kafka-like Stream Source
 */
export class KafkaSource<T = any> implements StreamSource<T> {
  constructor(
    private config: {
      topic: string;
      brokers: string[];
      groupId?: string;
      fromBeginning?: boolean;
    }
  ) {}

  createStream(): Readable {
    const config = this.config;
    return new Readable({
      objectMode: true,
      async read() {
        // Simulate reading from Kafka
        const message = {
          topic: config?.topic,
          partition: 0,
          offset: Date.now(),
          value: { data: Math.random() },
        };
        this.push(message);
        await new Promise((resolve) => setTimeout(resolve, 100));
      },
    });
  }
}

/**
 * Database Sink
 */
export class DatabaseSink<T = any> implements StreamSink<T> {
  constructor(
    private config: {
      table: string;
      batchSize?: number;
      connection?: string;
    }
  ) {}

  createStream(): Writable {
    const batch: T[] = [];
    const batchSize = this.config.batchSize || 100;

    return new Writable({
      objectMode: true,
      async write(chunk: T, encoding, callback) {
        batch.push(chunk);

        if (batch.length >= batchSize) {
          // Simulate batch write to database
          await new Promise((resolve) => setTimeout(resolve, 10));
          batch.length = 0;
        }

        callback();
      },
      async final(callback) {
        if (batch.length > 0) {
          // Write remaining batch
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        callback();
      },
    });
  }
}

/**
 * Create data pipeline helper
 */
export function createDataPipeline<T = any>(): StreamPipeline<T> {
  return new StreamPipeline<T>();
}

/**
 * Example stream processor implementation
 */
export class EnrichmentProcessor extends StreamProcessor<ChangeEvent, any> {
  async process(event: ChangeEvent, context: ProcessContext): Promise<any> {
    // Enrich the change event with additional data
    const enriched = {
      ...event,
      enrichedAt: Date.now(),
      context: {
        streamId: context.streamId,
        watermark: context.watermark,
      },
      // Simulate enrichment with external data
      additionalData: await this.fetchAdditionalData(event),
    };

    this.updateWatermark(event.timestamp);

    return enriched;
  }

  private async fetchAdditionalData(event: ChangeEvent): Promise<any> {
    // Simulate fetching additional data
    return {
      category: 'enriched',
      metadata: { source: event.source },
    };
  }
}

/**
 * Deduplication processor
 */
export class DeduplicationProcessor extends StreamProcessor<any, any> {
  private seen = new Set<string>();
  private windowSize = 60000; // 1 minute

  async process(element: any, context: ProcessContext): Promise<any | null> {
    const key = this.getKey(element);
    const now = Date.now();

    // Clean old entries
    this.cleanOldEntries(now);

    // Check for duplicate
    if (this.seen.has(key)) {
      return null; // Duplicate, filter out
    }

    this.seen.add(key);
    return element;
  }

  private getKey(element: any): string {
    return element.id || JSON.stringify(element);
  }

  private cleanOldEntries(now: number): void {
    // In production, would track timestamps per key
    // For simplicity, periodically clear all
    if (this.seen.size > 10000) {
      this.seen.clear();
    }
  }
}
