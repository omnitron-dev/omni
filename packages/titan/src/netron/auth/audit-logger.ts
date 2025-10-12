/**
 * Audit Logger for Netron Authentication System
 * Provides comprehensive audit trail functionality with pluggable storage
 * @module @omnitron-dev/titan/netron/auth
 */

import { Injectable, Optional } from '../../decorators/index.js';
import type { ILogger } from '../../modules/logger/logger.types.js';
import type { AuditEvent } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Audit filter for querying audit events
 */
export interface AuditFilter {
  /** Filter by user ID */
  userId?: string;

  /** Filter by service name */
  service?: string;

  /** Filter by method name */
  method?: string;

  /** Filter by success status */
  success?: boolean;

  /** Filter by time range (start) */
  startTime?: Date;

  /** Filter by time range (end) */
  endTime?: Date;

  /** Maximum number of results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;
}

/**
 * Audit storage adapter interface
 * Implement this interface to create custom storage backends
 */
export interface AuditStorageAdapter {
  /** Save an audit event to storage */
  save(event: AuditEvent): Promise<void>;

  /** Query audit events from storage */
  query(filter: AuditFilter): Promise<AuditEvent[]>;

  /** Clear all audit events */
  clear(): Promise<void>;
}

/**
 * Enhanced audit configuration
 */
export interface AuditLoggerConfig {
  /** Include method arguments in audit log */
  includeArgs?: boolean;

  /** Include method result in audit log */
  includeResult?: boolean;

  /** Include user context in audit log */
  includeUser?: boolean;

  /** Custom audit logger function (called in addition to storage) */
  logger?: ((event: AuditEvent) => void) | null;

  /** Storage adapter (defaults to MemoryAdapter) */
  storage?: AuditStorageAdapter;

  /** Maximum event size in bytes (default: 10KB) */
  maxEventSize?: number;

  /** Enable async logging (non-blocking) */
  async?: boolean;
}

/**
 * Enhanced audit event with additional fields
 */
export interface EnhancedAuditEvent extends AuditEvent {
  /** Whether the operation was successful */
  success: boolean;

  /** Error message if operation failed */
  error?: string;
}

/**
 * Memory-based audit storage adapter
 * Stores audit events in memory (useful for testing)
 */
export class MemoryAuditAdapter implements AuditStorageAdapter {
  private events: EnhancedAuditEvent[] = [];
  private maxSize: number;

  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
  }

  async save(event: AuditEvent): Promise<void> {
    // Ensure event is enhanced with success field
    const enhancedEvent = event as EnhancedAuditEvent;
    if (enhancedEvent.success === undefined) {
      enhancedEvent.success = !enhancedEvent.error;
    }

    this.events.push(enhancedEvent);

    // Implement circular buffer (FIFO when max size reached)
    if (this.events.length > this.maxSize) {
      this.events.shift();
    }
  }

  async query(filter: AuditFilter): Promise<AuditEvent[]> {
    let results = this.events.slice();

    // Apply filters
    if (filter.userId !== undefined) {
      results = results.filter((e) => e.userId === filter.userId);
    }

    if (filter.service !== undefined) {
      results = results.filter((e) => e.service === filter.service);
    }

    if (filter.method !== undefined) {
      results = results.filter((e) => e.method === filter.method);
    }

    if (filter.success !== undefined) {
      results = results.filter((e) => e.success === filter.success);
    }

    if (filter.startTime) {
      results = results.filter((e) => e.timestamp >= filter.startTime!);
    }

    if (filter.endTime) {
      results = results.filter((e) => e.timestamp <= filter.endTime!);
    }

    // Apply pagination
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? results.length;

    return results.slice(offset, offset + limit);
  }

  async clear(): Promise<void> {
    this.events = [];
  }

  /**
   * Get total number of events in memory
   */
  size(): number {
    return this.events.length;
  }

  /**
   * Get all events (useful for testing)
   */
  getAll(): EnhancedAuditEvent[] {
    return this.events.slice();
  }
}

/**
 * File-based audit storage adapter
 * Appends audit events to a JSON lines file
 */
export class FileAuditAdapter implements AuditStorageAdapter {
  private filePath: string;
  private writeQueue: AuditEvent[] = [];
  private flushing = false;
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(
    filePath: string,
    options?: {
      /** Auto-flush interval in milliseconds (default: 5000) */
      flushInterval?: number;
    }
  ) {
    this.filePath = filePath;

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Setup auto-flush
    if (options?.flushInterval) {
      this.flushInterval = setInterval(() => {
        void this.flush();
      }, options.flushInterval);
    }
  }

  async save(event: AuditEvent): Promise<void> {
    // Ensure event is enhanced with success field
    const enhancedEvent = event as EnhancedAuditEvent;
    if (enhancedEvent.success === undefined) {
      enhancedEvent.success = !enhancedEvent.error;
    }

    this.writeQueue.push(enhancedEvent);

    // Auto-flush if queue gets too large
    if (this.writeQueue.length >= 100) {
      await this.flush();
    }
  }

  async query(filter: AuditFilter): Promise<AuditEvent[]> {
    // Flush pending writes first
    await this.flush();

    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const content = fs.readFileSync(this.filePath, 'utf-8');
    const lines = content.split('\n').filter((line: string) => line.trim());

    let events: EnhancedAuditEvent[] = [];
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as EnhancedAuditEvent;
        // Restore Date objects
        event.timestamp = new Date(event.timestamp);
        events.push(event);
      } catch {
        // Skip invalid lines
      }
    }

    // Apply filters (same logic as MemoryAdapter)
    if (filter.userId !== undefined) {
      events = events.filter((e) => e.userId === filter.userId);
    }

    if (filter.service !== undefined) {
      events = events.filter((e) => e.service === filter.service);
    }

    if (filter.method !== undefined) {
      events = events.filter((e) => e.method === filter.method);
    }

    if (filter.success !== undefined) {
      events = events.filter((e) => e.success === filter.success);
    }

    if (filter.startTime) {
      events = events.filter((e) => e.timestamp >= filter.startTime!);
    }

    if (filter.endTime) {
      events = events.filter((e) => e.timestamp <= filter.endTime!);
    }

    // Apply pagination
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? events.length;

    return events.slice(offset, offset + limit);
  }

  async clear(): Promise<void> {
    this.writeQueue = [];
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }

  /**
   * Flush pending writes to disk
   */
  async flush(): Promise<void> {
    if (this.flushing || this.writeQueue.length === 0) {
      return;
    }

    this.flushing = true;
    try {
      const events = this.writeQueue.splice(0);
      const lines = events.map((event) => JSON.stringify(event)).join('\n') + '\n';

      fs.appendFileSync(this.filePath, lines, 'utf-8');
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    void this.flush();
  }
}

/**
 * Audit Logger
 * Provides comprehensive audit trail functionality for authentication and authorization
 *
 * Features:
 * - Pluggable storage adapters (Memory, File, Custom)
 * - Configurable event filtering (args, result, user)
 * - Query support with filtering and pagination
 * - Custom logger integration
 * - Async/non-blocking operation support
 * - Event size limiting
 *
 * @example
 * ```typescript
 * const auditLogger = new AuditLogger(logger, {
 *   includeArgs: true,
 *   includeResult: false,
 *   storage: new FileAuditAdapter('/var/log/audit.log')
 * });
 *
 * await auditLogger.logAuth({
 *   timestamp: new Date(),
 *   userId: 'user123',
 *   service: 'calculator',
 *   method: 'add',
 *   args: [1, 2],
 *   result: 3,
 *   success: true
 * });
 * ```
 */
@Injectable()
export class AuditLogger {
  private storage: AuditStorageAdapter;
  private config: Required<AuditLoggerConfig>;
  private logger: ILogger;

  constructor(logger: ILogger, @Optional() config?: AuditLoggerConfig) {
    this.logger = logger.child({ component: 'AuditLogger' });

    // Set defaults
    this.config = {
      includeArgs: config?.includeArgs ?? false,
      includeResult: config?.includeResult ?? false,
      includeUser: config?.includeUser ?? true,
      logger: config?.logger ?? null,
      storage: config?.storage ?? new MemoryAuditAdapter(),
      maxEventSize: config?.maxEventSize ?? 10 * 1024, // 10KB default
      async: config?.async ?? true,
    };

    this.storage = this.config.storage;

    this.logger.debug('AuditLogger initialized');
  }

  /**
   * Log an audit event
   * @param event - Audit event to log
   */
  async logAuth(event: AuditEvent): Promise<void> {
    try {
      // Create enhanced event
      const enhancedEvent = this.prepareEvent(event);

      // Call custom logger if configured
      if (this.config.logger) {
        try {
          this.config.logger(enhancedEvent);
        } catch (error) {
          this.logger.error({ error, event: enhancedEvent }, 'Custom audit logger failed');
        }
      }

      // Save to storage
      const savePromise = this.storage.save(enhancedEvent);

      if (this.config.async) {
        // Fire and forget (non-blocking)
        savePromise.catch((error) => {
          this.logger.error({ error, event: enhancedEvent }, 'Failed to save audit event');
        });
      } else {
        // Wait for completion (blocking)
        await savePromise;
      }

      this.logger.trace(
        {
          userId: enhancedEvent.userId,
          service: enhancedEvent.service,
          method: enhancedEvent.method,
          success: enhancedEvent.success,
        },
        'Audit event logged'
      );
    } catch (error) {
      this.logger.error({ error, event }, 'Failed to log audit event');
    }
  }

  /**
   * Query audit events
   * @param filter - Filter criteria
   * @returns Matching audit events
   */
  async query(filter: AuditFilter = {}): Promise<AuditEvent[]> {
    try {
      return await this.storage.query(filter);
    } catch (error) {
      this.logger.error({ error, filter }, 'Failed to query audit events');
      return [];
    }
  }

  /**
   * Clear all audit logs
   */
  async clearLogs(): Promise<void> {
    try {
      await this.storage.clear();
      this.logger.debug('Audit logs cleared');
    } catch (error) {
      this.logger.error({ error }, 'Failed to clear audit logs');
    }
  }

  /**
   * Update audit configuration
   * @param config - New configuration
   */
  configure(config: Partial<AuditLoggerConfig>): void {
    Object.assign(this.config, config);
    if (config.storage) {
      this.storage = config.storage;
    }
    this.logger.debug({ config }, 'Audit configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<Required<AuditLoggerConfig>> {
    return { ...this.config };
  }

  /**
   * Prepare event for logging (apply filters and size limits)
   */
  private prepareEvent(event: AuditEvent): EnhancedAuditEvent {
    const enhancedEvent: EnhancedAuditEvent = {
      timestamp: event.timestamp,
      service: event.service,
      method: event.method,
      success: true,
      metadata: event.metadata,
    };

    // Add user info if enabled
    if (this.config.includeUser && event.userId) {
      enhancedEvent.userId = event.userId;
    }

    // Add args if enabled
    if (this.config.includeArgs && event.args) {
      enhancedEvent.args = this.sanitizeData(event.args);
    }

    // Add result if enabled
    if (this.config.includeResult && event.result !== undefined) {
      enhancedEvent.result = this.sanitizeData(event.result);
    }

    // Add auth decision if present
    if (event.authDecision) {
      enhancedEvent.authDecision = event.authDecision;
      // Determine success from auth decision
      enhancedEvent.success = event.authDecision.allowed;
    }

    // Add error if present
    if ('error' in event && event.error) {
      enhancedEvent.error = String(event.error);
      enhancedEvent.success = false;
    }

    // Check size and truncate if needed
    const size = this.estimateSize(enhancedEvent);
    if (size > this.config.maxEventSize) {
      this.logger.warn({ size, maxSize: this.config.maxEventSize }, 'Audit event exceeds max size, truncating');
      enhancedEvent.metadata = {
        ...enhancedEvent.metadata,
        truncated: true,
        originalSize: size,
      };
      // Remove large fields
      if (enhancedEvent.args) {
        enhancedEvent.args = ['[TRUNCATED]'];
      }
      if (enhancedEvent.result) {
        enhancedEvent.result = '[TRUNCATED]';
      }
    }

    return enhancedEvent;
  }

  /**
   * Sanitize data for logging (remove sensitive information)
   */
  private sanitizeData(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeData(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      // Redact sensitive fields
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('key') ||
        lowerKey === 'pwd'
      ) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = this.sanitizeData(value);
      }
    }
    return sanitized;
  }

  /**
   * Estimate size of event in bytes
   */
  private estimateSize(event: any): number {
    return JSON.stringify(event).length;
  }
}
