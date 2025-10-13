/**
 * Custom Backend Integration
 *
 * Sends monitoring data to a custom backend endpoint.
 * Supports batching, retry logic, and custom headers.
 */

import type { CustomBackendConfig, AnalyticsEvent, ErrorInfo } from '../types.js';

/**
 * Event payload
 */
interface EventPayload {
  type: 'error' | 'event' | 'metric' | 'pageview';
  timestamp: number;
  data: any;
}

/**
 * Custom backend integration class
 */
export class CustomBackendIntegration {
  private config: CustomBackendConfig;
  private queue: EventPayload[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private retrying = false;

  constructor(config: CustomBackendConfig) {
    this.config = {
      enabled: true,
      batchSize: 10,
      flushInterval: 5000,
      ...config,
    };

    if (this.config.enabled) {
      this.startFlushTimer();
    }
  }

  /**
   * Start flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);
  }

  /**
   * Stop flush timer
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Track event
   */
  trackEvent(event: AnalyticsEvent): void {
    if (!this.config.enabled) return;

    this.addToQueue({
      type: 'event',
      timestamp: Date.now(),
      data: event,
    });
  }

  /**
   * Track error
   */
  trackError(error: Error, info?: ErrorInfo): void {
    if (!this.config.enabled) return;

    this.addToQueue({
      type: 'error',
      timestamp: Date.now(),
      data: {
        message: error.message,
        name: error.name,
        stack: error.stack,
        ...info,
      },
    });
  }

  /**
   * Track metric
   */
  trackMetric(name: string, value: number, tags?: Record<string, string>): void {
    if (!this.config.enabled) return;

    this.addToQueue({
      type: 'metric',
      timestamp: Date.now(),
      data: { name, value, tags },
    });
  }

  /**
   * Track page view
   */
  trackPageView(url: string, title?: string, referrer?: string): void {
    if (!this.config.enabled) return;

    this.addToQueue({
      type: 'pageview',
      timestamp: Date.now(),
      data: { url, title, referrer },
    });
  }

  /**
   * Add to queue
   */
  private addToQueue(payload: EventPayload): void {
    this.queue.push(payload);

    // Flush if batch size reached
    if (this.queue.length >= this.config.batchSize!) {
      this.flush();
    }
  }

  /**
   * Flush queue
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0 || this.retrying) return;

    const batch = this.queue.splice(0, this.config.batchSize);

    try {
      await this.sendBatch(batch);
    } catch (error) {
      console.error('Failed to send batch to backend:', error);
      // Re-add to queue for retry
      this.queue.unshift(...batch);
      this.retrying = true;

      // Retry after delay
      setTimeout(() => {
        this.retrying = false;
        this.flush();
      }, 5000);
    }
  }

  /**
   * Send batch to backend
   */
  private async sendBatch(batch: EventPayload[]): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        events: batch,
        metadata: {
          userAgent: navigator.userAgent,
          url: window.location.href,
          timestamp: Date.now(),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Backend responded with ${response.status}`);
    }
  }

  /**
   * Shutdown integration
   */
  async shutdown(): Promise<void> {
    this.stopFlushTimer();
    await this.flush();
  }
}

/**
 * Webhook integration class
 */
export class WebhookIntegration {
  private config: Required<
    Pick<CustomBackendConfig, 'endpoint' | 'headers'> & { method?: 'POST' | 'PUT' | 'PATCH' }
  >;
  private eventFilter?: (event: any) => boolean;

  constructor(config: CustomBackendConfig & { method?: 'POST' | 'PUT' | 'PATCH' }) {
    this.config = {
      endpoint: config.endpoint,
      method: config.method || 'POST',
      headers: config.headers || {},
    };
    this.eventFilter = (config as any).eventFilter;
  }

  /**
   * Send webhook
   */
  async send(event: any): Promise<void> {
    // Apply filter if provided
    if (this.eventFilter && !this.eventFilter(event)) {
      return;
    }

    try {
      const response = await fetch(this.config.endpoint, {
        method: this.config.method,
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        throw new Error(`Webhook responded with ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to send webhook:', error);
    }
  }

  /**
   * Track error via webhook
   */
  async trackError(error: Error, info?: ErrorInfo): Promise<void> {
    await this.send({
      type: 'error',
      timestamp: Date.now(),
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack,
        ...info,
      },
    });
  }

  /**
   * Track event via webhook
   */
  async trackEvent(event: AnalyticsEvent): Promise<void> {
    await this.send({
      type: 'event',
      timestamp: Date.now(),
      event,
    });
  }
}

/**
 * Create custom backend integration
 */
export function createCustomBackendIntegration(
  config: CustomBackendConfig
): CustomBackendIntegration {
  return new CustomBackendIntegration(config);
}

/**
 * Create webhook integration
 */
export function createWebhookIntegration(
  config: CustomBackendConfig & { method?: 'POST' | 'PUT' | 'PATCH' }
): WebhookIntegration {
  return new WebhookIntegration(config);
}
