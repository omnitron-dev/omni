/**
 * Event History Service
 * 
 * Manages event history and replay functionality
 */

import type { EventRecord, EventFilter } from '@omnitron-dev/eventemitter';

import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import { Inject, Optional, Injectable } from '@omnitron-dev/nexus';

import { LOGGER_TOKEN, EVENT_EMITTER_TOKEN } from './events.module.js';

import type { IEventReplayOptions } from './types.js';

/**
 * Service for managing event history
 */
@Injectable()
export class EventHistoryService {
  private isRecording = false;
  private isPaused = false;
  private customStorage?: any;
  private historyStore: Map<string, EventRecord[]> = new Map();
  private maxHistorySize = 1000;
  private initialized = false;
  private destroyed = false;
  private logger: any = null;

  constructor(
    @Inject(EVENT_EMITTER_TOKEN) private readonly emitter: EnhancedEventEmitter,
    
  ) { }

  /**
   * Initialize the service
   */
  async onInit(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.logger?.info('EventHistoryService initialized');
  }

  /**
   * Destroy the service
   */
  async onDestroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    // Clear all history data
    this.historyStore.clear();
    this.customStorage = undefined;

    this.logger?.info('EventHistoryService destroyed');
  }

  /**
   * Get health status
   */
  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details?: any }> {
    const totalRecords = Array.from(this.historyStore.values())
      .reduce((acc, records) => acc + records.length, 0);

    return {
      status: this.initialized && !this.destroyed ? 'healthy' : 'unhealthy',
      details: {
        initialized: this.initialized,
        destroyed: this.destroyed,
        isRecording: this.isRecording,
        isPaused: this.isPaused,
        totalRecords,
        maxHistorySize: this.maxHistorySize,
        eventCount: this.historyStore.size
      }
    };
  }

  /**
   * Record an event in history
   */
  record(record: {
    event: string;
    data: any;
    timestamp: number;
    metadata?: any;
    duration?: number;
    error?: Error;
  }): void {
    if (!this.isRecording || this.isPaused) return;

    const fullRecord: EventRecord = {
      event: record.event,
      data: record.data,
      timestamp: record.timestamp,
      metadata: record.metadata,
      duration: record.duration,
      error: record.error
    };

    // Get or create event history array
    const eventHistory = this.historyStore.get(record.event) || [];
    eventHistory.push(fullRecord);

    // Limit history size
    if (eventHistory.length > this.maxHistorySize) {
      eventHistory.shift(); // Remove oldest
    }

    this.historyStore.set(record.event, eventHistory);
  }

  /**
   * Get event history (synchronous)
   */
  getHistorySync(event?: string): EventRecord[] {
    if (event) {
      return this.historyStore.get(event) || [];
    }

    // Return all history
    const allHistory: EventRecord[] = [];
    for (const records of this.historyStore.values()) {
      allHistory.push(...records);
    }

    // Sort by timestamp
    return allHistory.sort((a, b) => a.timestamp - b.timestamp);
  }


  /**
   * Clear event history (synchronous)
   */
  clearSync(event?: string): void {
    if (event) {
      this.historyStore.delete(event);
    } else {
      this.historyStore.clear();
    }
  }

  /**
   * Clear event history (alias for compatibility)
   */
  clear(event?: string): void {
    this.clearSync(event);
  }

  /**
   * Set maximum history size
   */
  setMaxHistory(maxSize: number): void {
    this.maxHistorySize = maxSize;

    // Trim existing histories if needed
    for (const [event, records] of this.historyStore.entries()) {
      if (records.length > maxSize) {
        const trimmed = records.slice(-maxSize);
        this.historyStore.set(event, trimmed);
      }
    }
  }

  /**
   * Get history statistics (synchronous)
   */
  getStatisticsSync(): Record<string, number> {
    const stats: Record<string, number> = {};

    for (const [event, records] of this.historyStore.entries()) {
      stats[event] = records.length;
    }

    return stats;
  }

  /**
   * Start recording events
   */
  startRecording(options?: {
    filter?: (event: string) => boolean;
    maxSize?: number;
    ttl?: number;
  }): void {
    this.emitter.enableHistory({
      maxSize: options?.maxSize,
      ttl: options?.ttl,
      filter: options?.filter
    });
    this.isRecording = true;
  }

  /**
   * Stop recording events
   */
  stopRecording(): void {
    this.isRecording = false;
  }

  /**
   * Pause recording
   */
  pauseRecording(): void {
    this.isPaused = true;
  }

  /**
   * Resume recording
   */
  resumeRecording(): void {
    this.isPaused = false;
  }

  /**
   * Check if recording is active
   */
  isRecordingActive(): boolean {
    return this.isRecording && !this.isPaused;
  }

  /**
   * Get filtered event history (async)
   */
  async getFilteredHistory(filter?: EventFilter): Promise<EventRecord[]> {
    return this.emitter.getHistory(filter);
  }

  /**
   * Get event history (unified method)
   */
  getHistory(eventOrFilter?: string | EventFilter): EventRecord[] | Promise<EventRecord[]> {
    if (typeof eventOrFilter === 'string' || eventOrFilter === undefined) {
      return this.getHistorySync(eventOrFilter);
    }
    return this.getFilteredHistory(eventOrFilter);
  }

  /**
   * Clear event history
   */
  async clearHistory(): Promise<void> {
    return this.emitter.clearHistory();
  }

  /**
   * Export event history
   */
  async exportHistory(format: 'json' | 'csv' = 'json'): Promise<string> {
    const records = await this.emitter.exportHistory();

    if (format === 'json') {
      return JSON.stringify(records, null, 2);
    }

    // CSV format
    if (records.length === 0) return '';

    const headers = ['timestamp', 'event', 'data', 'metadata', 'duration', 'error'];
    const rows = records.map(record => [
      record.timestamp,
      record.event,
      JSON.stringify(record.data),
      JSON.stringify(record.metadata),
      record.duration || '',
      record.error?.message || ''
    ]);

    return [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
  }

  /**
   * Import event history
   */
  async importHistory(data: string, format: 'json' | 'csv' = 'json'): Promise<void> {
    let records: EventRecord[];

    if (format === 'json') {
      records = JSON.parse(data);
    } else {
      // Parse CSV
      const lines = data.split('\n');
      const headers = lines[0]?.split(',') || [];

      records = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.replace(/^"|"$/g, ''));
        const record: any = {};

        headers?.forEach((header, index) => {
          const value = values[index];
          if (value && (header === 'timestamp' || header === 'duration')) {
            record[header] = parseInt(value);
          } else if (value && (header === 'data' || header === 'metadata')) {
            record[header] = JSON.parse(value);
          } else {
            record[header] = value;
          }
        });

        return record as EventRecord;
      });
    }

    return this.emitter.importHistory(records);
  }

  /**
   * Replay events from history
   */
  async replay(options?: IEventReplayOptions): Promise<void> {
    // Convert filter to EventFilter format
    const filter: EventFilter | undefined = options?.filter ? {
      event: Array.isArray(options.filter.event)
        ? new RegExp(options.filter.event.join('|'))
        : options.filter.event,
      from: options.filter.from,
      to: options.filter.to
    } : undefined;

    const records = await this.getFilteredHistory(filter);

    if (options?.dryRun) {
      this.logger?.info(`Would replay ${records.length} events`);
      return;
    }

    for (const record of records) {
      // Skip failed events if configured
      if (options?.skipErrors && record.error) {
        continue;
      }

      // Transform event if configured
      let eventData = record.data;
      if (options?.transform) {
        eventData = options.transform(record);
      }

      // Apply replay speed
      if (options?.speed && options.speed !== 1) {
        await this.delay(record.duration ? record.duration / options.speed : 100);
      }

      // Replay the event
      await this.emitter.emitEnhanced(record.event, eventData, {
        metadata: {
          ...record.metadata,
          replayed: true,
          originalTimestamp: record.timestamp,
          replayedAt: Date.now()
        }
      });
    }
  }

  /**
   * Get event timeline
   */
  async getTimeline(options?: {
    from?: Date;
    to?: Date;
    events?: string[];
    groupBy?: 'minute' | 'hour' | 'day';
  }): Promise<Array<{
    time: string;
    count: number;
    events: string[];
  }>> {
    const records = await this.getFilteredHistory({
      from: options?.from,
      to: options?.to,
      event: options?.events
        ? new RegExp(options.events.join('|'))
        : undefined
    });

    const timeline = new Map<string, { count: number; events: Set<string> }>();

    for (const record of records) {
      const time = this.getTimeKey(record.timestamp, options?.groupBy || 'minute');

      if (!timeline.has(time)) {
        timeline.set(time, { count: 0, events: new Set() });
      }

      const entry = timeline.get(time)!;
      entry.count++;
      entry.events.add(record.event);
    }

    return Array.from(timeline.entries()).map(([time, data]) => ({
      time,
      count: data.count,
      events: Array.from(data.events)
    }));
  }

  /**
   * Search history
   */
  async searchHistory(query: {
    text?: string;
    event?: string;
    from?: Date;
    to?: Date;
    hasError?: boolean;
  }): Promise<EventRecord[]> {
    const records = await this.getFilteredHistory({
      event: query.event,
      from: query.from,
      to: query.to
    });

    return records.filter(record => {
      if (query.hasError !== undefined) {
        const hasError = !!record.error;
        if (hasError !== query.hasError) return false;
      }

      if (query.text) {
        const searchText = query.text.toLowerCase();
        const recordText = JSON.stringify(record).toLowerCase();
        if (!recordText.includes(searchText)) return false;
      }

      return true;
    });
  }

  /**
   * Get event statistics from history
   */
  async getStatistics(): Promise<{
    totalEvents: number;
    uniqueEvents: number;
    errorRate: number;
    avgDuration: number;
    topEvents: Array<{ event: string; count: number }>;
  }> {
    const records = await this.emitter.exportHistory();

    const eventCounts = new Map<string, number>();
    let totalDuration = 0;
    let errorCount = 0;

    for (const record of records) {
      // Count events
      eventCounts.set(
        record.event,
        (eventCounts.get(record.event) || 0) + 1
      );

      // Sum durations
      if (record.duration) {
        totalDuration += record.duration;
      }

      // Count errors
      if (record.error) {
        errorCount++;
      }
    }

    // Get top events
    const topEvents = Array.from(eventCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([event, count]) => ({ event, count }));

    return {
      totalEvents: records.length,
      uniqueEvents: eventCounts.size,
      errorRate: records.length > 0 ? errorCount / records.length : 0,
      avgDuration: records.length > 0 ? totalDuration / records.length : 0,
      topEvents
    };
  }

  /**
   * Create snapshot of current history
   */
  async createSnapshot(name: string): Promise<void> {
    const records = await this.emitter.exportHistory();
    const snapshot = {
      name,
      timestamp: Date.now(),
      records
    };

    // Store snapshot (would use actual storage in production)
    if (this.customStorage) {
      await this.customStorage.saveSnapshot(snapshot);
    }
  }

  /**
   * Restore from snapshot
   */
  async restoreSnapshot(name: string): Promise<void> {
    if (!this.customStorage) {
      throw new Error('No storage configured for snapshots');
    }

    const snapshot = await this.customStorage.loadSnapshot(name);
    await this.emitter.importHistory(snapshot.records);
  }

  /**
   * Get time key for grouping
   */
  private getTimeKey(timestamp: number, groupBy: 'minute' | 'hour' | 'day'): string {
    const date = new Date(timestamp);

    switch (groupBy) {
      case 'minute':
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`;
      case 'hour':
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:00`;
      case 'day':
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
      default:
        return date.toISOString();
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}