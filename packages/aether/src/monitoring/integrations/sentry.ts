/**
 * Sentry Integration
 *
 * Integrates with Sentry for error tracking and performance monitoring.
 * Supports error grouping, breadcrumbs, and user context.
 */

import type { SentryConfig, ErrorInfo, Breadcrumb, UserInfo } from '../types.js';

/**
 * Sentry client interface
 */
interface SentryClient {
  captureException(error: Error, context?: any): string;
  captureMessage(message: string, level?: string): string;
  setUser(user: any): void;
  setTag(key: string, value: string): void;
  setContext(name: string, context: any): void;
  addBreadcrumb(breadcrumb: any): void;
  configureScope(callback: (scope: any) => void): void;
}

/**
 * Sentry integration class
 */
export class SentryIntegration {
  private config: SentryConfig;
  private client: SentryClient | null = null;
  private initialized = false;

  constructor(config: SentryConfig) {
    this.config = {
      enabled: true,
      sampleRate: 1,
      tracesSampleRate: 0.1,
      ...config,
    };
  }

  /**
   * Initialize Sentry
   */
  async init(): Promise<void> {
    if (this.initialized || !this.config.enabled) return;

    try {
      // Load Sentry SDK dynamically
      const Sentry = await this.loadSentrySDK();

      if (Sentry) {
        Sentry.init({
          dsn: this.config.dsn,
          environment: this.config.environment || 'production',
          release: this.config.release,
          sampleRate: this.config.sampleRate,
          tracesSampleRate: this.config.tracesSampleRate,
          beforeSend: this.config.beforeSend,
          beforeBreadcrumb: this.config.beforeBreadcrumb,
          ignoreErrors: this.config.ignoreErrors,
          denyUrls: this.config.denyUrls,
          integrations: [
            // Add Sentry integrations
            new Sentry.BrowserTracing(),
          ],
        });

        this.client = Sentry;
        this.initialized = true;
      }
    } catch (error) {
      console.error('Failed to initialize Sentry:', error);
    }
  }

  /**
   * Load Sentry SDK
   */
  private async loadSentrySDK(): Promise<any> {
    try {
      // Try to import Sentry if available
      // In a real implementation, this would use dynamic import
      // or load the SDK from CDN
      return (window as any).Sentry;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Track error
   */
  trackError(error: Error, info?: ErrorInfo): string | null {
    if (!this.client || !this.initialized) return null;

    try {
      const context: any = {};

      if (info?.context) {
        context.extra = info.context;
      }

      if (info?.tags) {
        context.tags = info.tags;
      }

      if (info?.user) {
        context.user = this.formatUser(info.user);
      }

      if (info?.breadcrumbs) {
        info.breadcrumbs.forEach((breadcrumb) => {
          this.client!.addBreadcrumb(this.formatBreadcrumb(breadcrumb));
        });
      }

      if (info?.fingerprint) {
        context.fingerprint = info.fingerprint;
      }

      if (info?.severity) {
        context.level = this.mapSeverity(info.severity);
      }

      return this.client.captureException(error, context);
    } catch (err) {
      console.error('Failed to send error to Sentry:', err);
      return null;
    }
  }

  /**
   * Add breadcrumb
   */
  addBreadcrumb(breadcrumb: Breadcrumb): void {
    if (!this.client || !this.initialized) return;

    try {
      this.client.addBreadcrumb(this.formatBreadcrumb(breadcrumb));
    } catch (error) {
      console.error('Failed to add breadcrumb to Sentry:', error);
    }
  }

  /**
   * Set user
   */
  setUser(user: UserInfo | null): void {
    if (!this.client || !this.initialized) return;

    try {
      if (user) {
        this.client.setUser(this.formatUser(user));
      } else {
        this.client.setUser(null);
      }
    } catch (error) {
      console.error('Failed to set user in Sentry:', error);
    }
  }

  /**
   * Set tag
   */
  setTag(key: string, value: string): void {
    if (!this.client || !this.initialized) return;

    try {
      this.client.setTag(key, value);
    } catch (error) {
      console.error('Failed to set tag in Sentry:', error);
    }
  }

  /**
   * Set context
   */
  setContext(name: string, context: any): void {
    if (!this.client || !this.initialized) return;

    try {
      this.client.setContext(name, context);
    } catch (error) {
      console.error('Failed to set context in Sentry:', error);
    }
  }

  /**
   * Format user for Sentry
   */
  private formatUser(user: UserInfo): any {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      ip_address: user.ipAddress,
      ...user.properties,
    };
  }

  /**
   * Format breadcrumb for Sentry
   */
  private formatBreadcrumb(breadcrumb: Breadcrumb): any {
    return {
      type: breadcrumb.type,
      category: breadcrumb.category,
      message: breadcrumb.message,
      level: breadcrumb.level,
      timestamp: breadcrumb.timestamp / 1000, // Sentry uses seconds
      data: breadcrumb.data,
    };
  }

  /**
   * Map severity to Sentry level
   */
  private mapSeverity(severity: string): string {
    const mapping: Record<string, string> = {
      fatal: 'fatal',
      error: 'error',
      warning: 'warning',
      info: 'info',
      debug: 'debug',
    };
    return mapping[severity] || 'error';
  }

  /**
   * Flush pending events
   */
  async flush(timeout = 2000): Promise<void> {
    if (!this.client || !this.initialized) return;

    try {
      if ((this.client as any).flush) {
        await (this.client as any).flush(timeout);
      }
    } catch (error) {
      console.error('Failed to flush Sentry events:', error);
    }
  }

  /**
   * Close Sentry client
   */
  async close(): Promise<void> {
    if (!this.client || !this.initialized) return;

    try {
      if ((this.client as any).close) {
        await (this.client as any).close(2000);
      }
      this.initialized = false;
      this.client = null;
    } catch (error) {
      console.error('Failed to close Sentry client:', error);
    }
  }
}

/**
 * Create Sentry integration
 */
export function createSentryIntegration(config: SentryConfig): SentryIntegration {
  return new SentryIntegration(config);
}
