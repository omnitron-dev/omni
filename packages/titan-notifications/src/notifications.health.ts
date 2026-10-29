import type { MessagingTransport, TransportHealth } from './transport/transport.interface.js';
import type { NotificationsEventEmitter } from './notifications.events.js';
import { describeError } from '@omnitron-dev/titan/diagnostics';

/**
 * Health status for the Notifications module.
 */
export interface NotificationsHealthStatus {
  /** Overall health status */
  status: 'healthy' | 'unhealthy' | 'degraded';

  /** Optional message describing the health status */
  message?: string;

  /** Transport layer health */
  transport: TransportHealth;

  /** Health check latency in milliseconds */
  latency?: number;
  events?: ReturnType<NotificationsEventEmitter['snapshot']>;
}

/**
 * Health indicator for the Notifications notification system.
 * Provides health checks and liveness/readiness probes.
 */
export class NotificationsHealthIndicator {
  constructor(private readonly transport: MessagingTransport, private readonly events?: Pick<NotificationsEventEmitter, 'snapshot'>) {}

  /**
   * Perform a comprehensive health check of the notification system.
   *
   * @returns Health status including transport health and latency
   */
  async check(): Promise<NotificationsHealthStatus> {
    // performance.now() for the same reason as the transport's own probe:
    // Date.now()'s 1ms granularity turns a sub-millisecond check into 0.
    const startTime = performance.now();

    try {
      const transportHealth = await this.transport.healthCheck();
      const latency = performance.now() - startTime;
      const events = this.events?.snapshot();
      const failedEvents = Boolean(events?.unresolved.length);
      const status = transportHealth.status === 'healthy' && failedEvents ? 'degraded' : transportHealth.status;

      return {
        status,
        message: transportHealth.error || (failedEvents ? 'Notification lifecycle handlers have unresolved failures' : this.getStatusMessage(status)),
        transport: transportHealth,
        latency,
        ...(events ? { events } : {}),
      };
    } catch (error) {
      const latency = performance.now() - startTime;

      return {
        status: 'unhealthy',
        message: describeError(error),
        transport: {
          status: 'unhealthy',
          connected: false,
          error: describeError(error),
          timestamp: Date.now(),
        },
        latency,
      };
    }
  }

  /**
   * Check if the notification system is alive (basic connectivity).
   *
   * @returns True if the system is responsive
   */
  async isAlive(): Promise<boolean> {
    try {
      const health = await this.check();
      return health.status !== 'unhealthy';
    } catch {
      return false;
    }
  }

  /**
   * Check if the notification system is ready to handle requests.
   *
   * @returns True if the system is fully operational
   */
  async isReady(): Promise<boolean> {
    try {
      const health = await this.check();
      return health.status === 'healthy' && health.transport.connected;
    } catch {
      return false;
    }
  }

  /**
   * Get a descriptive message based on the health status.
   *
   * @param status - The health status
   * @returns A descriptive message
   */
  private getStatusMessage(status: 'healthy' | 'unhealthy' | 'degraded'): string {
    switch (status) {
      case 'healthy':
        return 'Notifications system is fully operational';
      case 'degraded':
        return 'Notifications system is operational but experiencing issues';
      case 'unhealthy':
        return 'Notifications system is not operational';
      default:
        return 'Unknown health status';
    }
  }
}
