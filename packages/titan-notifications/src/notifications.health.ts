import type { MessagingTransport, TransportHealth } from './transport/transport.interface.js';

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
}

/**
 * Health indicator for the Notifications notification system.
 * Provides health checks and liveness/readiness probes.
 */
export class NotificationsHealthIndicator {
  constructor(private readonly transport: MessagingTransport) {}

  /**
   * Perform a comprehensive health check of the notification system.
   *
   * @returns Health status including transport health and latency
   */
  async check(): Promise<NotificationsHealthStatus> {
    const startTime = Date.now();

    try {
      const transportHealth = await this.transport.healthCheck();
      const latency = Date.now() - startTime;

      return {
        status: transportHealth.status,
        message: transportHealth.error || this.getStatusMessage(transportHealth.status),
        transport: transportHealth,
        latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;

      return {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Unknown error during health check',
        transport: {
          status: 'unhealthy',
          connected: false,
          error: error instanceof Error ? error.message : String(error),
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
