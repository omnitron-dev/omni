import type { EmitterMetrics, MetricsOptions } from './types';

/**
 * Performance metrics collector for EventEmitter
 */
export class MetricsCollector {
  private enabled = false;
  private options: MetricsOptions;
  
  // Metrics data
  private eventsEmitted = 0;
  private eventsFailed = 0;
  private listenerCounts = new Map<string, number>();
  private processingTimes = new Map<string, number[]>();
  private slowestEvents: Array<{ event: string; duration: number }> = [];
  private eventCounts = new Map<string, number>();
  private errorCounts = new Map<string, number>();
  private startTime = Date.now();
  
  constructor(options: MetricsOptions = {}) {
    this.options = {
      slowThreshold: options.slowThreshold || 100,
      sampleRate: options.sampleRate || 1,
      trackMemory: options.trackMemory !== false
    };
  }

  /**
   * Enable metrics collection
   */
  enable(): void {
    this.enabled = true;
    this.startTime = Date.now();
  }

  /**
   * Disable metrics collection
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Check if metrics are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Record event emission
   */
  recordEmission(event: string, success: boolean, duration?: number): void {
    if (!this.enabled) return;
    
    // Sample rate check
    if (this.options.sampleRate! < 1 && Math.random() > this.options.sampleRate!) {
      return;
    }

    // Update counters
    this.eventsEmitted++;
    const count = this.eventCounts.get(event) || 0;
    this.eventCounts.set(event, count + 1);

    if (!success) {
      this.eventsFailed++;
      const errorCount = this.errorCounts.get(event) || 0;
      this.errorCounts.set(event, errorCount + 1);
    }

    // Record processing time
    if (duration !== undefined) {
      let times = this.processingTimes.get(event);
      if (!times) {
        times = [];
        this.processingTimes.set(event, times);
      }
      times.push(duration);
      
      // Keep only last 100 samples per event
      if (times.length > 100) {
        times.shift();
      }

      // Track slow events
      if (duration > this.options.slowThreshold!) {
        this.addSlowEvent(event, duration);
      }
    }
  }

  /**
   * Update listener count for an event
   */
  updateListenerCount(event: string, count: number): void {
    if (!this.enabled) return;
    this.listenerCounts.set(event, count);
  }

  /**
   * Get current metrics
   */
  getMetrics(): EmitterMetrics {
    const avgProcessingTime = new Map<string, number>();
    
    // Calculate average processing times
    for (const [event, times] of this.processingTimes.entries()) {
      if (times.length > 0) {
        const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
        avgProcessingTime.set(event, avg);
      }
    }

    // Calculate memory usage if enabled
    let memoryUsage = 0;
    if (this.options.trackMemory && typeof process !== 'undefined' && process.memoryUsage) {
      memoryUsage = process.memoryUsage().heapUsed;
    }

    return {
      eventsEmitted: this.eventsEmitted,
      eventsFailed: this.eventsFailed,
      listenerCount: new Map(this.listenerCounts),
      avgProcessingTime,
      slowestEvents: [...this.slowestEvents],
      memoryUsage,
      eventCounts: new Map(this.eventCounts),
      errorCounts: new Map(this.errorCounts)
    };
  }

  /**
   * Export metrics in different formats
   */
  export(format: 'json' | 'prometheus' = 'json'): string {
    const metrics = this.getMetrics();
    
    if (format === 'json') {
      return JSON.stringify({
        timestamp: Date.now(),
        uptime: Date.now() - this.startTime,
        metrics: {
          eventsEmitted: metrics.eventsEmitted,
          eventsFailed: metrics.eventsFailed,
          listenerCount: Object.fromEntries(metrics.listenerCount),
          avgProcessingTime: Object.fromEntries(metrics.avgProcessingTime),
          slowestEvents: metrics.slowestEvents,
          memoryUsage: metrics.memoryUsage,
          eventCounts: Object.fromEntries(metrics.eventCounts),
          errorCounts: Object.fromEntries(metrics.errorCounts)
        }
      }, null, 2);
    } else if (format === 'prometheus') {
      // Prometheus format
      const lines: string[] = [];
      
      lines.push(`# HELP eventemitter_events_emitted_total Total number of events emitted`);
      lines.push(`# TYPE eventemitter_events_emitted_total counter`);
      lines.push(`eventemitter_events_emitted_total ${metrics.eventsEmitted}`);
      
      lines.push(`# HELP eventemitter_events_failed_total Total number of failed events`);
      lines.push(`# TYPE eventemitter_events_failed_total counter`);
      lines.push(`eventemitter_events_failed_total ${metrics.eventsFailed}`);
      
      lines.push(`# HELP eventemitter_memory_usage_bytes Current memory usage in bytes`);
      lines.push(`# TYPE eventemitter_memory_usage_bytes gauge`);
      lines.push(`eventemitter_memory_usage_bytes ${metrics.memoryUsage}`);
      
      // Per-event metrics
      for (const [event, count] of metrics.eventCounts.entries()) {
        lines.push(`eventemitter_event_count{event="${event}"} ${count}`);
      }
      
      for (const [event, count] of metrics.listenerCount.entries()) {
        lines.push(`eventemitter_listener_count{event="${event}"} ${count}`);
      }
      
      for (const [event, time] of metrics.avgProcessingTime.entries()) {
        lines.push(`eventemitter_avg_processing_time_ms{event="${event}"} ${time}`);
      }
      
      return lines.join('\n');
    }
    
    return '';
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.eventsEmitted = 0;
    this.eventsFailed = 0;
    this.listenerCounts.clear();
    this.processingTimes.clear();
    this.slowestEvents = [];
    this.eventCounts.clear();
    this.errorCounts.clear();
    this.startTime = Date.now();
  }

  /**
   * Add a slow event to the tracking list
   */
  private addSlowEvent(event: string, duration: number): void {
    this.slowestEvents.push({ event, duration });
    
    // Sort by duration (slowest first)
    this.slowestEvents.sort((a, b) => b.duration - a.duration);
    
    // Keep only top 10 slowest
    if (this.slowestEvents.length > 10) {
      this.slowestEvents = this.slowestEvents.slice(0, 10);
    }
  }

  /**
   * Get summary statistics
   */
  getSummary(): string {
    const metrics = this.getMetrics();
    const uptime = Date.now() - this.startTime;
    const eventsPerSecond = this.eventsEmitted / (uptime / 1000);
    const failureRate = this.eventsEmitted > 0 
      ? (this.eventsFailed / this.eventsEmitted * 100).toFixed(2)
      : '0.00';

    return `
EventEmitter Metrics Summary:
=============================
Uptime: ${Math.floor(uptime / 1000)}s
Total Events: ${this.eventsEmitted}
Failed Events: ${this.eventsFailed}
Failure Rate: ${failureRate}%
Events/Second: ${eventsPerSecond.toFixed(2)}
Unique Events: ${metrics.eventCounts.size}
Total Listeners: ${Array.from(metrics.listenerCount.values()).reduce((sum, c) => sum + c, 0)}
Memory Usage: ${(metrics.memoryUsage / 1024 / 1024).toFixed(2)} MB
Slowest Event: ${this.slowestEvents[0]?.event || 'N/A'} (${this.slowestEvents[0]?.duration || 0}ms)
`.trim();
  }
}