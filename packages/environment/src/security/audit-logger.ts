/**
 * Audit Logger
 * Records security-relevant events for compliance and analysis
 */

export interface AuditEvent {
  id: string;
  timestamp: number;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  result: 'success' | 'failure' | 'denied';
  reason?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditQuery {
  userId?: string;
  action?: string;
  resource?: string;
  result?: AuditEvent['result'];
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export class AuditLogger {
  private events: AuditEvent[];
  private maxEvents: number;
  private enabled: boolean;

  constructor(options: { maxEvents?: number; enabled?: boolean } = {}) {
    this.events = [];
    this.maxEvents = options.maxEvents ?? 10000;
    this.enabled = options.enabled ?? true;
  }

  /**
   * Log an audit event
   */
  log(event: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent {
    if (!this.enabled) {
      return { id: '', timestamp: 0, ...event };
    }

    const auditEvent: AuditEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      ...event,
    };

    this.events.push(auditEvent);

    // Limit size
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    return auditEvent;
  }

  /**
   * Log a successful action
   */
  logSuccess(userId: string, action: string, resource: string, metadata?: Record<string, unknown>): AuditEvent {
    return this.log({
      userId,
      action,
      resource,
      result: 'success',
      metadata,
    });
  }

  /**
   * Log a failed action
   */
  logFailure(
    userId: string,
    action: string,
    resource: string,
    reason: string,
    metadata?: Record<string, unknown>
  ): AuditEvent {
    return this.log({
      userId,
      action,
      resource,
      result: 'failure',
      reason,
      metadata,
    });
  }

  /**
   * Log a denied action
   */
  logDenied(
    userId: string,
    action: string,
    resource: string,
    reason: string,
    metadata?: Record<string, unknown>
  ): AuditEvent {
    return this.log({
      userId,
      action,
      resource,
      result: 'denied',
      reason,
      metadata,
    });
  }

  /**
   * Query audit events
   */
  query(query: AuditQuery = {}): AuditEvent[] {
    let results = [...this.events];

    if (query.userId) {
      results = results.filter((e) => e.userId === query.userId);
    }

    if (query.action) {
      results = results.filter((e) => e.action === query.action);
    }

    if (query.resource) {
      results = results.filter((e) => e.resource === query.resource);
    }

    if (query.result) {
      results = results.filter((e) => e.result === query.result);
    }

    if (query.startTime) {
      results = results.filter((e) => e.timestamp >= query.startTime!);
    }

    if (query.endTime) {
      results = results.filter((e) => e.timestamp <= query.endTime!);
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Get all events
   */
  getAllEvents(): AuditEvent[] {
    return [...this.events];
  }

  /**
   * Get events count
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
   * Enable/disable logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byResult: Record<string, number>;
    byAction: Record<string, number>;
    byUser: Record<string, number>;
  } {
    const byResult: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    const byUser: Record<string, number> = {};

    for (const event of this.events) {
      byResult[event.result] = (byResult[event.result] || 0) + 1;
      byAction[event.action] = (byAction[event.action] || 0) + 1;
      byUser[event.userId] = (byUser[event.userId] || 0) + 1;
    }

    return {
      total: this.events.length,
      byResult,
      byAction,
      byUser,
    };
  }

  private generateId(): string {
    return `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
