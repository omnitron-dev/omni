import type { EventRecord, EventFilter, EventStorage, EventHistoryOptions } from './types.js';

/**
 * In-memory event storage implementation
 */
export class MemoryEventStorage implements EventStorage {
  private records: EventRecord[] = [];
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  async save(record: EventRecord): Promise<void> {
    this.records.push(record);

    // Maintain max size
    if (this.records.length > this.maxSize) {
      this.records.shift(); // Remove oldest
    }
  }

  async load(filter?: EventFilter): Promise<EventRecord[]> {
    if (!filter) return [...this.records];

    return this.records.filter((record) => {
      // Filter by event name/pattern
      if (filter.event) {
        if (typeof filter.event === 'string') {
          if (!record.event.includes(filter.event)) return false;
        } else if (filter.event instanceof RegExp) {
          if (!filter.event.test(record.event)) return false;
        }
      }

      // Filter by time range
      if (filter.from && record.timestamp < filter.from.getTime()) return false;
      if (filter.to && record.timestamp > filter.to.getTime()) return false;

      // Filter by tags
      if (filter.tags && filter.tags.length > 0) {
        const recordTags = record.metadata.tags || [];
        if (!filter.tags.some((tag) => recordTags.includes(tag))) return false;
      }

      // Filter by correlation ID
      if (filter.correlationId && record.metadata.correlationId !== filter.correlationId) {
        return false;
      }

      return true;
    });
  }

  async clear(): Promise<void> {
    this.records = [];
  }
}

/**
 * Event history manager
 */
export class EventHistory {
  private enabled = false;
  private storage: EventStorage;
  private options: EventHistoryOptions;
  private filter?: (event: string) => boolean;

  constructor(options: EventHistoryOptions = {}) {
    this.options = options;
    this.storage = options.storage || new MemoryEventStorage(options.maxSize);
    this.filter = options.filter;
  }

  /**
   * Enable history recording
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable history recording
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Check if history is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Record an event
   */
  async record(record: EventRecord): Promise<void> {
    if (!this.enabled) return;

    // Apply filter if configured
    if (this.filter && !this.filter(record.event)) return;

    // Check TTL if configured
    if (this.options.ttl) {
      const now = Date.now();
      const age = now - record.timestamp;
      if (age > this.options.ttl) return;
    }

    await this.storage.save(record);
  }

  /**
   * Get event history
   */
  async getHistory(filter?: EventFilter): Promise<EventRecord[]> {
    const records = await this.storage.load(filter);

    // Apply TTL filter if configured
    if (this.options.ttl) {
      const now = Date.now();
      return records.filter((record) => {
        const age = now - record.timestamp;
        return age <= this.options.ttl!;
      });
    }

    return records;
  }

  /**
   * Clear history
   */
  async clear(): Promise<void> {
    await this.storage.clear();
  }

  /**
   * Export history for backup/testing
   */
  async export(): Promise<EventRecord[]> {
    return this.storage.load();
  }

  /**
   * Import history from backup/testing
   */
  async import(records: EventRecord[]): Promise<void> {
    await this.clear();
    for (const record of records) {
      await this.storage.save(record);
    }
  }

  /**
   * Get statistics about recorded events
   */
  async getStats(): Promise<{
    totalEvents: number;
    uniqueEvents: number;
    errorCount: number;
    avgDuration: number;
    eventCounts: Map<string, number>;
  }> {
    const records = await this.storage.load();
    const eventCounts = new Map<string, number>();
    let totalDuration = 0;
    let errorCount = 0;
    let durationCount = 0;

    for (const record of records) {
      // Count events
      const count = eventCounts.get(record.event) || 0;
      eventCounts.set(record.event, count + 1);

      // Count errors
      if (record.error) errorCount++;

      // Calculate average duration
      if (record.duration !== undefined) {
        totalDuration += record.duration;
        durationCount++;
      }
    }

    return {
      totalEvents: records.length,
      uniqueEvents: eventCounts.size,
      errorCount,
      avgDuration: durationCount > 0 ? totalDuration / durationCount : 0,
      eventCounts,
    };
  }
}
