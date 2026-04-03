/**
 * Webhook Notification Channel
 *
 * Delivers notifications via HTTP POST to recipient webhook URLs.
 * Supports custom headers, HMAC signing, timeouts, and retries.
 */

import { createHmac } from 'node:crypto';
import { generateUuidV7 } from '@omnitron-dev/titan/utils';
import { Injectable } from '@omnitron-dev/titan/decorators';
import type { NotificationPayload, NotificationRecipient } from '../../notifications.types.js';
import type { NotificationChannel } from '../channel.interface.js';
import {
  ChannelType,
  type ChannelContent,
  type ChannelSendResult,
  type ChannelHealth,
  type WebhookContent,
} from '../channel.interface.js';

/**
 * Configuration options for WebhookChannel
 */
export interface WebhookChannelOptions {
  /**
   * Request timeout in milliseconds
   * @default 5000
   */
  timeout?: number;

  /**
   * Number of retry attempts on failure
   * @default 3
   */
  retries?: number;

  /**
   * Delay between retries in milliseconds
   * @default 1000
   */
  retryDelay?: number;

  /**
   * Custom HTTP headers to include in all requests
   */
  headers?: Record<string, string>;

  /**
   * Secret key for HMAC signature generation
   * If provided, a signature will be added to the request headers
   */
  signatureSecret?: string;

  /**
   * HTTP header name for the HMAC signature
   * @default 'X-Webhook-Signature'
   */
  signatureHeader?: string;

  /**
   * HMAC algorithm to use for signing
   * @default 'sha256'
   */
  signatureAlgorithm?: 'sha1' | 'sha256' | 'sha512';

  /**
   * Whether to include a timestamp in requests
   * @default true
   */
  includeTimestamp?: boolean;

  /**
   * HTTP header name for the timestamp
   * @default 'X-Webhook-Timestamp'
   */
  timestampHeader?: string;

  /**
   * Whether to validate SSL certificates
   * @default true
   */
  validateSSL?: boolean;

  /**
   * User agent string for requests
   * @default 'Notifications-Webhook/1.0'
   */
  userAgent?: string;
}

/**
 * Webhook delivery channel implementation
 */
@Injectable()
export class WebhookChannel implements NotificationChannel {
  readonly name = 'webhook';
  readonly type = ChannelType.Webhook;

  private readonly options: Required<WebhookChannelOptions>;
  private healthCheckUrl?: string;

  constructor(options?: WebhookChannelOptions) {
    this.options = {
      timeout: 5000,
      retries: 3,
      retryDelay: 1000,
      headers: {},
      signatureSecret: '',
      signatureHeader: 'X-Webhook-Signature',
      signatureAlgorithm: 'sha256',
      includeTimestamp: true,
      timestampHeader: 'X-Webhook-Timestamp',
      validateSSL: true,
      userAgent: 'Notifications-Webhook/1.0',
      ...options,
    };
  }

  /**
   * Configure the channel options
   */
  configure(options: WebhookChannelOptions): void {
    Object.assign(this.options, options);
  }

  /**
   * Set a health check URL for availability testing
   */
  setHealthCheckUrl(url: string): void {
    this.healthCheckUrl = url;
  }

  /**
   * Initialize the channel
   */
  async initialize(): Promise<void> {
    // No initialization needed for webhook channel
  }

  /**
   * Shutdown the channel
   */
  async shutdown(): Promise<void> {
    // No cleanup needed for webhook channel
  }

  /**
   * Check if the channel is available
   * If healthCheckUrl is set, performs a HEAD request to verify connectivity
   */
  async isAvailable(): Promise<boolean> {
    if (!this.healthCheckUrl) {
      return true; // Assume available if no health check URL configured
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeout);

      const response = await fetch(this.healthCheckUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Perform health check
   */
  async healthCheck(): Promise<ChannelHealth> {
    const startTime = Date.now();
    try {
      const available = await this.isAvailable();
      const latency = Date.now() - startTime;

      return {
        name: this.name,
        type: this.type,
        available,
        latency,
        metadata: {
          healthCheckUrl: this.healthCheckUrl,
          timeout: this.options.timeout,
          retries: this.options.retries,
          signingEnabled: !!this.options.signatureSecret,
        },
      };
    } catch (error) {
      return {
        name: this.name,
        type: this.type,
        available: false,
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Validate recipient has a webhook URL
   */
  validateRecipient(recipient: NotificationRecipient): boolean {
    return !!recipient.webhookUrl && this.isValidUrl(recipient.webhookUrl);
  }

  /**
   * Format notification into webhook payload
   */
  formatContent(notification: NotificationPayload): WebhookContent {
    return {
      payload: {
        id: notification.id || generateUuidV7(),
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data,
        priority: notification.priority,
        metadata: notification.metadata,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Send notification to webhook URL
   */
  async send(recipient: NotificationRecipient, content: ChannelContent): Promise<ChannelSendResult> {
    if (!recipient.webhookUrl) {
      return {
        success: false,
        error: 'Recipient does not have a webhook URL',
      };
    }

    const webhookContent = content as WebhookContent;
    const messageId = (webhookContent.payload['id'] as string) || generateUuidV7();

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      try {
        const result = await this.sendRequest(recipient.webhookUrl, webhookContent);
        return {
          success: true,
          messageId,
          metadata: {
            statusCode: result.status,
            attempt: attempt + 1,
            url: recipient.webhookUrl,
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx)
        if (error instanceof Response && error.status >= 400 && error.status < 500) {
          break;
        }

        // Wait before retrying (except on last attempt)
        if (attempt < this.options.retries) {
          await this.delay(this.options.retryDelay * (attempt + 1));
        }
      }
    }

    return {
      success: false,
      messageId,
      error: lastError?.message || 'Unknown error',
      metadata: {
        attempts: this.options.retries + 1,
        url: recipient.webhookUrl,
      },
    };
  }

  // Private helper methods

  private async sendRequest(url: string, content: WebhookContent): Promise<Response> {
    const body = JSON.stringify(content.payload);
    const headers = this.buildHeaders(body, content.headers);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  private buildHeaders(body: string, customHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': this.options.userAgent,
      ...this.options.headers,
      ...customHeaders,
    };

    // Add timestamp header
    if (this.options.includeTimestamp) {
      headers[this.options.timestampHeader] = Date.now().toString();
    }

    // Add HMAC signature
    if (this.options.signatureSecret) {
      const signature = this.generateSignature(body);
      headers[this.options.signatureHeader] = signature;
    }

    return headers;
  }

  private generateSignature(body: string): string {
    const hmac = createHmac(this.options.signatureAlgorithm, this.options.signatureSecret);
    hmac.update(body);
    return `${this.options.signatureAlgorithm}=${hmac.digest('hex')}`;
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Verify webhook signature
 * Utility function for webhook receivers to verify request authenticity
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string,
  algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha256'
): boolean {
  const hmac = createHmac(algorithm, secret);
  hmac.update(body);
  const expectedSignature = `${algorithm}=${hmac.digest('hex')}`;
  return signature === expectedSignature;
}
