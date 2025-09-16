/**
 * Event History Service
 * 
 * Manages event history and replay functionality
 */

import type { EventRecord, EventFilter } from '@omnitron-dev/eventemitter';

import { Inject, Injectable } from '@omnitron-dev/nexus';
import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';

import { EVENT_EMITTER_TOKEN } from './events.module';

import type { EventReplayOptions } from './types';

/**
 * Service for managing event history
 */
@Injectable()
export class EventHistoryService {
  private isRecording = false;
  private isPaused = false;
  private customStorage?: any;

  constructor(
    @Inject(EVENT_EMITTER_TOKEN) private readonly emitter: EnhancedEventEmitter
  ) { }

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
   * Get event history
   */
  async getHistory(filter?: EventFilter): Promise<EventRecord[]> {
    return this.emitter.getHistory(filter);
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
  async replay(options?: EventReplayOptions): Promise<void> {
    // Convert filter to EventFilter format
    const filter: EventFilter | undefined = options?.filter ? {
      event: Array.isArray(options.filter.event) 
        ? new RegExp(options.filter.event.join('|'))
        : options.filter.event,
      from: options.filter.from,
      to: options.filter.to
    } : undefined;
    
    const records = await this.getHistory(filter);

    if (options?.dryRun) {
      console.log(`Would replay ${records.length} events`);
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
    const records = await this.getHistory({
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
    const records = await this.getHistory({
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