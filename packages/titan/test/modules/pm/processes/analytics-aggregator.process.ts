/**
 * Analytics Aggregator Service Process
 * Used in real-world scenario tests for data analytics stream processing
 */

import { Process, Public } from '../../../../src/modules/pm/decorators.js';

interface AnalyticsEvent {
  userId: string;
  eventType: 'page_view' | 'click' | 'purchase' | 'signup';
  timestamp: number;
  metadata: Record<string, any>;
}

interface AggregatedStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  uniqueUsers: Set<string>;
  timeWindow: { start: number; end: number };
}

@Process({ name: 'analytics-aggregator', version: '1.0.0' })
export default class AnalyticsAggregatorService {
  private stats: AggregatedStats = {
    totalEvents: 0,
    eventsByType: {},
    uniqueUsers: new Set(),
    timeWindow: { start: Date.now(), end: Date.now() }
  };

  @Public()
  async *processEventStream(events: AsyncIterable<AnalyticsEvent>): AsyncGenerator<AggregatedStats> {
    for await (const event of events) {
      // Process event
      this.stats.totalEvents++;
      this.stats.eventsByType[event.eventType] = (this.stats.eventsByType[event.eventType] || 0) + 1;
      this.stats.uniqueUsers.add(event.userId);
      this.stats.timeWindow.end = event.timestamp;

      // Yield stats every 10 events
      if (this.stats.totalEvents % 10 === 0) {
        yield {
          ...this.stats,
          uniqueUsers: new Set(this.stats.uniqueUsers) // Clone set
        };
      }
    }

    // Yield final stats
    yield this.stats;
  }

  @Public()
  async getStats(): Promise<Omit<AggregatedStats, 'uniqueUsers'> & { uniqueUserCount: number }> {
    return {
      totalEvents: this.stats.totalEvents,
      eventsByType: { ...this.stats.eventsByType },
      uniqueUserCount: this.stats.uniqueUsers.size,
      timeWindow: { ...this.stats.timeWindow }
    };
  }

  @Public()
  async resetStats(): Promise<void> {
    this.stats = {
      totalEvents: 0,
      eventsByType: {},
      uniqueUsers: new Set(),
      timeWindow: { start: Date.now(), end: Date.now() }
    };
  }
}