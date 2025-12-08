import { Injectable } from '../../decorators/index.js';
import { Redis } from 'ioredis';
import type { ILogger } from '../logger/logger.types.js';

export interface AnalyticsOptions {
  enabled?: boolean;
  storage?: 'redis' | 'timescale';
  retention?: number; // days
  realtime?: boolean;
}

export interface NotificationEvent {
  id: string;
  type: 'sent' | 'delivered' | 'opened' | 'clicked' | 'failed' | 'bounced';
  notificationId: string;
  recipientId: string;
  channel: string;
  category?: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface AnalyticsQuery {
  startDate?: Date | number;
  endDate?: Date | number;
  channel?: string;
  category?: string;
  recipientId?: string;
  notificationId?: string;
  type?: string;
  limit?: number;
}

export interface NotificationStatistics {
  total: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
  bounced: number;

  // Rates
  openRate: number;
  clickRate: number;
  conversionRate: number;
  bounceRate: number;
  successRate: number;

  // Channel breakdown
  byChannel: Map<string, ChannelStatistics>;

  // Time series data
  timeSeries?: TimeSeriesData[];

  // Performance metrics
  avgDeliveryTime: number;
  avgResponseTime: number;
}

export interface ChannelStatistics {
  channel: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
}

export interface TimeSeriesData {
  timestamp: number;
  count: number;
  type: string;
}

export interface NotificationReport {
  period: ReportPeriod;
  statistics: NotificationStatistics;
  topPerformers?: TopPerformer[];
  issues?: Issue[];
  recommendations?: string[];
  comparison?: PeriodComparison;
}

export interface ReportPeriod {
  start: Date;
  end: Date;
  type: 'daily' | 'weekly' | 'monthly' | 'custom';
}

export interface TopPerformer {
  notificationId: string;
  title: string;
  metrics: {
    sent: number;
    openRate: number;
    clickRate: number;
  };
}

export interface Issue {
  type: 'high_bounce' | 'low_engagement' | 'delivery_failure';
  channel?: string;
  count: number;
  description: string;
}

export interface PeriodComparison {
  current: NotificationStatistics;
  previous: NotificationStatistics;
  changes: {
    sent: number;
    delivered: number;
    openRate: number;
    clickRate: number;
  };
}

@Injectable()
export class NotificationAnalytics {
  private readonly ANALYTICS_KEY_PREFIX = 'notifications:analytics:';
  private readonly EVENT_TTL = 90 * 86400; // 90 days default

  constructor(
    private redis: Redis,
    private options?: AnalyticsOptions,
    private logger?: ILogger,
  ) {}

  /**
   * Track a notification event
   */
  async track(event: NotificationEvent): Promise<void> {
    // Store event in Redis sorted set
    const dayKey = this.getDayKey(event.timestamp);
    const eventData = JSON.stringify(event);

    // Store in daily bucket
    await this.redis.zadd(`${this.ANALYTICS_KEY_PREFIX}events:${dayKey}`, event.timestamp, eventData);

    // Update counters
    await this.updateCounters(event);

    // Set TTL for automatic cleanup
    const ttl = (this.options?.retention || 90) * 86400;
    await this.redis.expire(`${this.ANALYTICS_KEY_PREFIX}events:${dayKey}`, ttl);

    // Publish event for real-time subscribers
    if (this.options?.realtime) {
      const channel = `${this.ANALYTICS_KEY_PREFIX}events`;
      await this.redis.publish(channel, eventData);
    }
  }

  /**
   * Update analytics counters
   */
  private async updateCounters(event: NotificationEvent): Promise<void> {
    const dayKey = this.getDayKey(event.timestamp);
    const multi = this.redis.multi();

    // Global counters
    multi.hincrby(`${this.ANALYTICS_KEY_PREFIX}counters:${dayKey}`, event.type, 1);
    multi.hincrby(`${this.ANALYTICS_KEY_PREFIX}counters:${dayKey}`, 'total', 1);

    // Channel-specific counters
    if (event.channel) {
      multi.hincrby(`${this.ANALYTICS_KEY_PREFIX}channel:${event.channel}:${dayKey}`, event.type, 1);
    }

    // Category-specific counters
    if (event.category) {
      multi.hincrby(`${this.ANALYTICS_KEY_PREFIX}category:${event.category}:${dayKey}`, event.type, 1);
    }

    // User-specific counters
    multi.hincrby(`${this.ANALYTICS_KEY_PREFIX}user:${event.recipientId}:${dayKey}`, event.type, 1);

    await multi.exec();
  }

  /**
   * Query notification events
   */
  async queryEvents(query: AnalyticsQuery): Promise<NotificationEvent[]> {
    const events: NotificationEvent[] = [];
    const startDate = query.startDate ? new Date(query.startDate) : new Date(Date.now() - 7 * 86400000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();

    // Iterate through daily buckets
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dayKey = this.getDayKey(currentDate.getTime());
      const key = `${this.ANALYTICS_KEY_PREFIX}events:${dayKey}`;

      // Get events from sorted set
      const storedEvents = await this.redis.zrangebyscore(
        key,
        startDate.getTime(),
        endDate.getTime(),
        'LIMIT',
        0,
        query.limit || 1000
      );

      // Parse and filter events
      for (const eventData of storedEvents) {
        try {
          const event = JSON.parse(eventData) as NotificationEvent;

          // Apply filters
          if (query.channel && event.channel !== query.channel) continue;
          if (query.category && event.category !== query.category) continue;
          if (query.recipientId && event.recipientId !== query.recipientId) continue;
          if (query.notificationId && event.notificationId !== query.notificationId) continue;
          if (query.type && event.type !== query.type) continue;

          events.push(event);
        } catch {
          // Skip invalid entries
        }
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return events;
  }

  /**
   * Get notification statistics
   */
  async getStatistics(query: AnalyticsQuery): Promise<NotificationStatistics> {
    const events = await this.queryEvents(query);

    // Calculate basic counts
    const sent = events.filter((e) => e.type === 'sent').length;
    const delivered = events.filter((e) => e.type === 'delivered').length;
    const opened = events.filter((e) => e.type === 'opened').length;
    const clicked = events.filter((e) => e.type === 'clicked').length;
    const failed = events.filter((e) => e.type === 'failed').length;
    const bounced = events.filter((e) => e.type === 'bounced').length;

    // Calculate rates
    const openRate = delivered > 0 ? (opened / delivered) * 100 : 0;
    const clickRate = opened > 0 ? (clicked / opened) * 100 : 0;
    const conversionRate = delivered > 0 ? (clicked / delivered) * 100 : 0;
    const bounceRate = sent > 0 ? (bounced / sent) * 100 : 0;
    const successRate = sent > 0 ? (delivered / sent) * 100 : 0;

    // Channel breakdown
    const byChannel = this.groupByChannel(events);

    // Calculate performance metrics
    const avgDeliveryTime = this.calculateAvgDeliveryTime(events);
    const avgResponseTime = this.calculateAvgResponseTime(events);

    // Generate time series if requested
    const timeSeries = query.startDate && query.endDate ? this.generateTimeSeries(events, query) : undefined;

    return {
      total: events.length,
      sent,
      delivered,
      opened,
      clicked,
      failed,
      bounced,
      openRate,
      clickRate,
      conversionRate,
      bounceRate,
      successRate,
      byChannel,
      timeSeries,
      avgDeliveryTime,
      avgResponseTime,
    };
  }

  /**
   * Generate notification report
   */
  async generateReport(
    period: ReportPeriod,
    options: { compareToPrevious?: boolean; comparison?: boolean } = {}
  ): Promise<NotificationReport> {
    const query: AnalyticsQuery = {
      startDate: period.start,
      endDate: period.end,
    };

    const statistics = await this.getStatistics(query);

    // Get top performers
    const topPerformers = await this.getTopPerformers(query);

    // Identify issues
    const issues = this.identifyIssues(statistics);

    // Generate recommendations
    const recommendations = this.generateRecommendations(statistics);

    // Compare with previous period if requested
    let comparison: PeriodComparison | undefined;
    if (options.compareToPrevious || options.comparison) {
      comparison = await this.compareWithPreviousPeriod(period, statistics);
    }

    return {
      period,
      statistics,
      topPerformers,
      issues,
      recommendations,
      comparison,
    };
  }

  /**
   * Group events by channel
   */
  private groupByChannel(events: NotificationEvent[]): Map<string, ChannelStatistics> {
    const channelStats = new Map<string, ChannelStatistics>();

    for (const event of events) {
      if (!event.channel) continue;

      if (!channelStats.has(event.channel)) {
        channelStats.set(event.channel, {
          channel: event.channel,
          sent: 0,
          delivered: 0,
          opened: 0,
          clicked: 0,
          failed: 0,
        });
      }

      const stats = channelStats.get(event.channel)!;
      switch (event.type) {
        case 'sent':
          stats.sent++;
          break;
        case 'delivered':
          stats.delivered++;
          break;
        case 'opened':
          stats.opened++;
          break;
        case 'clicked':
          stats.clicked++;
          break;
        case 'failed':
          stats.failed++;
          break;
        default:
      }
    }

    return channelStats;
  }

  /**
   * Calculate average delivery time
   */
  private calculateAvgDeliveryTime(events: NotificationEvent[]): number {
    const sentEvents = new Map<string, number>();
    const deliveryTimes: number[] = [];

    for (const event of events) {
      if (event.type === 'sent') {
        sentEvents.set(event.notificationId, event.timestamp);
      } else if (event.type === 'delivered' && sentEvents.has(event.notificationId)) {
        const sentTime = sentEvents.get(event.notificationId)!;
        deliveryTimes.push(event.timestamp - sentTime);
      }
    }

    if (deliveryTimes.length === 0) return 0;

    const total = deliveryTimes.reduce((sum, time) => sum + time, 0);
    return total / deliveryTimes.length;
  }

  /**
   * Calculate average response time (time to open)
   */
  private calculateAvgResponseTime(events: NotificationEvent[]): number {
    const deliveredEvents = new Map<string, number>();
    const responseTimes: number[] = [];

    for (const event of events) {
      if (event.type === 'delivered') {
        deliveredEvents.set(event.notificationId, event.timestamp);
      } else if (event.type === 'opened' && deliveredEvents.has(event.notificationId)) {
        const deliveredTime = deliveredEvents.get(event.notificationId)!;
        responseTimes.push(event.timestamp - deliveredTime);
      }
    }

    if (responseTimes.length === 0) return 0;

    const total = responseTimes.reduce((sum, time) => sum + time, 0);
    return total / responseTimes.length;
  }

  /**
   * Generate time series data
   */
  private generateTimeSeries(events: NotificationEvent[], query: AnalyticsQuery): TimeSeriesData[] {
    const timeSeries: TimeSeriesData[] = [];
    const buckets = new Map<string, Map<string, number>>();

    for (const event of events) {
      const hour = Math.floor(event.timestamp / 3600000) * 3600000;
      const key = `${hour}-${event.type}`;

      if (!buckets.has(key)) {
        buckets.set(key, new Map());
      }

      const bucket = buckets.get(key)!;
      bucket.set(event.type, (bucket.get(event.type) || 0) + 1);
    }

    // Convert to time series format
    for (const [key, counts] of buckets) {
      const [timestamp, type] = key.split('-');
      if (timestamp) {
        for (const [eventType, count] of counts) {
          timeSeries.push({
            timestamp: parseInt(timestamp),
            count,
            type: eventType,
          });
        }
      }
    }

    return timeSeries.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get top performing notifications
   */
  private async getTopPerformers(query: AnalyticsQuery): Promise<TopPerformer[]> {
    // In a real implementation, would analyze notification performance
    // For now, return empty array
    return [];
  }

  /**
   * Identify issues in notification performance
   */
  private identifyIssues(statistics: NotificationStatistics): Issue[] {
    const issues: Issue[] = [];

    // Check for high bounce rate
    if (statistics.bounceRate > 10) {
      issues.push({
        type: 'high_bounce',
        count: statistics.bounced,
        description: `High bounce rate detected: ${statistics.bounceRate.toFixed(2)}%`,
      });
    }

    // Check for low engagement
    if (statistics.openRate < 20 && statistics.sent > 100) {
      issues.push({
        type: 'low_engagement',
        count: statistics.opened,
        description: `Low open rate detected: ${statistics.openRate.toFixed(2)}%`,
      });
    }

    // Check for delivery failures
    if (statistics.failed > statistics.sent * 0.05) {
      issues.push({
        type: 'delivery_failure',
        count: statistics.failed,
        description: `High failure rate: ${((statistics.failed / statistics.sent) * 100).toFixed(2)}%`,
      });
    }

    return issues;
  }

  /**
   * Generate recommendations based on statistics
   */
  private generateRecommendations(statistics: NotificationStatistics): string[] {
    const recommendations: string[] = [];

    if (statistics.openRate < 20) {
      recommendations.push('Consider improving notification titles and preview text');
    }

    if (statistics.clickRate < 5) {
      recommendations.push('Optimize notification content and call-to-action');
    }

    if (statistics.bounceRate > 10) {
      recommendations.push('Review recipient list quality and email validation');
    }

    if (statistics.avgDeliveryTime > 60000) {
      recommendations.push('Investigate delivery delays and optimize sending infrastructure');
    }

    return recommendations;
  }

  /**
   * Compare with previous period
   */
  private async compareWithPreviousPeriod(
    period: ReportPeriod,
    currentStats: NotificationStatistics
  ): Promise<PeriodComparison> {
    // Calculate previous period dates
    const duration = period.end.getTime() - period.start.getTime();
    const previousStart = new Date(period.start.getTime() - duration);
    const previousEnd = new Date(period.end.getTime() - duration);

    const previousQuery: AnalyticsQuery = {
      startDate: previousStart,
      endDate: previousEnd,
    };

    const previousStats = await this.getStatistics(previousQuery);

    return {
      current: currentStats,
      previous: previousStats,
      changes: {
        sent: ((currentStats.sent - previousStats.sent) / previousStats.sent) * 100,
        delivered: ((currentStats.delivered - previousStats.delivered) / previousStats.delivered) * 100,
        openRate: currentStats.openRate - previousStats.openRate,
        clickRate: currentStats.clickRate - previousStats.clickRate,
      },
    };
  }

  /**
   * Get day key for bucketing
   */
  private getDayKey(timestamp: number | Date): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  /**
   * Clean up old analytics data
   */
  async cleanupOldData(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date(Date.now() - daysToKeep * 86400000);
    const pattern = `${this.ANALYTICS_KEY_PREFIX}*`;

    const keys = await this.redis.keys(pattern);
    let deleted = 0;

    for (const key of keys) {
      // Extract date from key if possible
      const match = key.match(/\d{4}-\d{2}-\d{2}/);
      if (match) {
        const keyDate = new Date(match[0]);
        if (keyDate < cutoffDate) {
          await this.redis.del(key);
          deleted++;
        }
      }
    }

    return deleted;
  }

  /**
   * Alias for cleanupOldData
   */
  async cleanup(): Promise<number> {
    const retentionDays = this.options?.retention || 90;
    return this.cleanupOldData(retentionDays);
  }

  /**
   * Subscribe to real-time events
   */
  async subscribeToEvents(callback: (event: NotificationEvent) => void): Promise<() => void> {
    if (!this.options?.realtime) {
      return () => {}; // No-op if real-time is disabled
    }

    // Subscribe to Redis pub/sub channel
    const subRedis = this.redis.duplicate();
    const channel = `${this.ANALYTICS_KEY_PREFIX}events`;

    await subRedis.subscribe(channel);

    subRedis.on('message', (ch, message) => {
      if (ch === channel) {
        try {
          const event = JSON.parse(message) as NotificationEvent;
          callback(event);
        } catch (err) {
          // Log parse errors - malformed messages in Redis should be tracked
          this.logger?.error({ err, channel, message }, 'Failed to parse notification event from Redis channel');
        }
      }
    });

    // Return unsubscribe function
    return () => {
      subRedis.unsubscribe(channel);
      subRedis.disconnect();
    };
  }

  /**
   * Subscribe to real-time statistics updates
   */
  async subscribeToStats(
    callback: (stats: NotificationStatistics) => void,
    interval: number = 5000
  ): Promise<() => void> {
    if (!this.options?.realtime) {
      return () => {}; // No-op if real-time is disabled
    }

    // Set up interval to calculate and emit stats
    const intervalId = setInterval(async () => {
      try {
        const stats = await this.getStatistics({
          startDate: Date.now() - 86400000, // Last 24 hours
          endDate: Date.now(),
        });
        callback(stats);
      } catch (err) {
        // Ignore errors in stats calculation
      }
    }, interval);

    // Return cleanup function
    return () => {
      clearInterval(intervalId);
    };
  }
}
