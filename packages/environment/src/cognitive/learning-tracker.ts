/**
 * Learning Tracker
 * Tracks system learning and optimization over time
 */

export interface LearningEvent {
  timestamp: number;
  type: 'optimization' | 'prediction' | 'anomaly';
  description: string;
  impact?: number;
  metadata?: Record<string, unknown>;
}

export class LearningTracker {
  private events: LearningEvent[];
  private maxEvents: number;

  constructor(maxEvents: number = 1000) {
    this.events = [];
    this.maxEvents = maxEvents;
  }

  /**
   * Record a learning event
   */
  record(event: Omit<LearningEvent, 'timestamp'>): void {
    this.events.push({
      timestamp: Date.now(),
      ...event,
    });

    // Limit size
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  /**
   * Get all events
   */
  getEvents(): LearningEvent[] {
    return [...this.events];
  }

  /**
   * Get events by type
   */
  getEventsByType(type: LearningEvent['type']): LearningEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /**
   * Get learning statistics
   */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    totalImpact: number;
  } {
    const byType: Record<string, number> = {};
    let totalImpact = 0;

    for (const event of this.events) {
      byType[event.type] = (byType[event.type] || 0) + 1;
      if (event.impact) {
        totalImpact += event.impact;
      }
    }

    return {
      total: this.events.length,
      byType,
      totalImpact,
    };
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = [];
  }
}
