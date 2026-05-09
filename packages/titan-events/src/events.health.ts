import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { EVENTS_SERVICE_TOKEN } from './tokens.js';
import type { EventsService } from './events.service.js';

export interface EventsHealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  details?: Record<string, unknown>;
}

export interface EventsHealthThresholds {
  /** Max tolerable error rate across all tracked events (0-1, default: 0.05) */
  maxErrorRate?: number;
  /** Max tolerable avg processing time in ms (default: 100) */
  maxAvgProcessingTimeMs?: number;
  /** Max listener count per event before warning (default: 50) */
  maxListenersPerEvent?: number;
}

const DEFAULT_THRESHOLDS: Required<EventsHealthThresholds> = {
  maxErrorRate: 0.05,
  maxAvgProcessingTimeMs: 100,
  maxListenersPerEvent: 50,
};

@Injectable()
export class EventsHealthIndicator {
  readonly name = 'events';

  private readonly thresholds: Required<EventsHealthThresholds>;

  constructor(
    @Inject(EVENTS_SERVICE_TOKEN) private readonly eventsService: EventsService,
    thresholds: EventsHealthThresholds = {}
  ) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  async check(): Promise<EventsHealthCheckResult> {
    try {
      const inner = await this.eventsService.health();
      if (inner.status === 'unhealthy') {
        return {
          status: 'unhealthy',
          message: 'EventsService reports unhealthy (not initialized or already destroyed)',
          details: inner.details,
        };
      }

      const statsMap = this.eventsService.getStatistics();
      const eventNames = this.eventsService.getEventNames();

      const issues: string[] = [];
      const warnings: string[] = [];

      let totalEmits = 0;
      let totalErrors = 0;
      let maxListeners = 0;
      let slowEvents: string[] = [];

      if (statsMap instanceof Map) {
        for (const [event, stats] of statsMap) {
          totalEmits += stats.emitCount;
          totalErrors += stats.errorCount;

          if (stats.listenerCount > maxListeners) {
            maxListeners = stats.listenerCount;
          }

          if (stats.listenerCount > this.thresholds.maxListenersPerEvent) {
            warnings.push(
              `Event "${event}" has ${stats.listenerCount} listeners (threshold: ${this.thresholds.maxListenersPerEvent})`
            );
          }

          if (stats.avgProcessingTime > this.thresholds.maxAvgProcessingTimeMs) {
            slowEvents.push(event);
          }
        }
      }

      const errorRate = totalEmits > 0 ? totalErrors / totalEmits : 0;

      if (errorRate > this.thresholds.maxErrorRate) {
        const msg = `High error rate: ${(errorRate * 100).toFixed(1)}% (threshold: ${(this.thresholds.maxErrorRate * 100).toFixed(1)}%)`;
        if (errorRate > this.thresholds.maxErrorRate * 3) {
          issues.push(msg);
        } else {
          warnings.push(msg);
        }
      }

      if (slowEvents.length > 0) {
        warnings.push(
          `Slow average processing on ${slowEvents.length} event(s): ${slowEvents.slice(0, 3).join(', ')}${slowEvents.length > 3 ? '…' : ''}`
        );
      }

      let status: EventsHealthCheckResult['status'];
      let message: string;

      if (issues.length > 0) {
        status = 'unhealthy';
        message = issues.join('; ');
      } else if (warnings.length > 0) {
        status = 'degraded';
        message = warnings.join('; ');
      } else {
        status = 'healthy';
        message = `Events operating normally. ${eventNames.length} event type(s), ${totalEmits} total emissions`;
      }

      return {
        status,
        message,
        details: {
          ...inner.details,
          eventCount: eventNames.length,
          totalEmissions: totalEmits,
          totalErrors,
          errorRate,
          maxListenersOnSingleEvent: maxListeners,
          slowEventCount: slowEvents.length,
          thresholds: this.thresholds,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Events health check failed: ${error instanceof Error ? error.message : String(error)}`,
        details: { error: String(error) },
      };
    }
  }

  async isHealthy(): Promise<boolean> {
    const result = await this.check();
    return result.status === 'healthy';
  }
}
