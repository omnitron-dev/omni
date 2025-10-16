/**
 * Telemetry System
 * Collects and exports telemetry data
 */

export interface TelemetryEvent {
  name: string;
  timestamp: number;
  properties?: Record<string, unknown>;
  measurements?: Record<string, number>;
}

export interface TelemetryOptions {
  enabled?: boolean;
  maxEvents?: number;
  batchSize?: number;
}

export class Telemetry {
  private events: TelemetryEvent[];
  private readonly options: Required<TelemetryOptions>;
  private enabled: boolean;

  constructor(options: TelemetryOptions = {}) {
    this.events = [];
    this.options = {
      enabled: options.enabled ?? true,
      maxEvents: options.maxEvents ?? 10000,
      batchSize: options.batchSize ?? 100,
    };
    this.enabled = this.options.enabled;
  }

  /**
   * Track an event
   */
  trackEvent(
    name: string,
    properties?: Record<string, unknown>,
    measurements?: Record<string, number>,
  ): void {
    if (!this.enabled) return;

    const event: TelemetryEvent = {
      name,
      timestamp: Date.now(),
      properties,
      measurements,
    };

    this.events.push(event);

    // Limit size
    if (this.events.length > this.options.maxEvents) {
      this.events.shift();
    }
  }

  /**
   * Track a page view
   */
  trackPageView(page: string, properties?: Record<string, unknown>): void {
    this.trackEvent('PageView', { page, ...properties });
  }

  /**
   * Track an exception
   */
  trackException(error: Error, properties?: Record<string, unknown>): void {
    this.trackEvent('Exception', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      ...properties,
    });
  }

  /**
   * Track a metric
   */
  trackMetric(
    name: string,
    value: number,
    properties?: Record<string, unknown>,
  ): void {
    this.trackEvent('Metric', properties, { [name]: value });
  }

  /**
   * Track a dependency call
   */
  trackDependency(
    name: string,
    duration: number,
    success: boolean,
    properties?: Record<string, unknown>,
  ): void {
    this.trackEvent(
      'Dependency',
      { name, success, ...properties },
      { duration },
    );
  }

  /**
   * Track a request
   */
  trackRequest(
    name: string,
    duration: number,
    success: boolean,
    properties?: Record<string, unknown>,
  ): void {
    this.trackEvent(
      'Request',
      { name, success, ...properties },
      { duration },
    );
  }

  /**
   * Get all events
   */
  getEvents(): TelemetryEvent[] {
    return [...this.events];
  }

  /**
   * Get events by name
   */
  getEventsByName(name: string): TelemetryEvent[] {
    return this.events.filter((e) => e.name === name);
  }

  /**
   * Get events in time range
   */
  getEventsByTimeRange(startTime: number, endTime: number): TelemetryEvent[] {
    return this.events.filter(
      (e) => e.timestamp >= startTime && e.timestamp <= endTime,
    );
  }

  /**
   * Get event count
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = [];
  }

  /**
   * Enable/disable telemetry
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if telemetry is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byName: Record<string, number>;
    timeRange: { start: number; end: number } | null;
  } {
    const byName: Record<string, number> = {};

    for (const event of this.events) {
      byName[event.name] = (byName[event.name] || 0) + 1;
    }

    let timeRange = null;
    if (this.events.length > 0) {
      timeRange = {
        start: this.events[0].timestamp,
        end: this.events[this.events.length - 1].timestamp,
      };
    }

    return {
      total: this.events.length,
      byName,
      timeRange,
    };
  }

  /**
   * Export events for external processing
   */
  export(): TelemetryEvent[] {
    const exported = [...this.events];
    this.events = [];
    return exported;
  }

  /**
   * Get batch of events
   */
  getBatch(size?: number): TelemetryEvent[] {
    const batchSize = size ?? this.options.batchSize;
    return this.events.slice(0, batchSize);
  }

  /**
   * Remove batch of events
   */
  removeBatch(size?: number): TelemetryEvent[] {
    const batchSize = size ?? this.options.batchSize;
    return this.events.splice(0, batchSize);
  }
}
