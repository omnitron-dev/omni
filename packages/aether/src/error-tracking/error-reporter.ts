/**
 * Error Reporter with Integration Support
 *
 * Provides error reporting with support for popular error tracking services
 * like Sentry, Rollbar, Bugsnag, etc.
 *
 * @module error-tracking/error-reporter
 */

export interface ErrorReportConfig {
  dsn?: string;
  environment?: string;
  release?: string;
  debug?: boolean;
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
  integration?: 'sentry' | 'rollbar' | 'bugsnag' | 'custom';
  customIntegration?: ErrorIntegration;
}

export interface ErrorEvent {
  message: string;
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  timestamp: number;
  fingerprint?: string[];
  tags?: Record<string, string>;
  contexts?: Record<string, any>;
  breadcrumbs?: Array<{
    type: string;
    category: string;
    message: string;
    level: string;
    timestamp: number;
  }>;
  user?: {
    id?: string;
    username?: string;
    email?: string;
  };
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  };
  extra?: Record<string, any>;
  exception?: {
    type: string;
    value: string;
    stacktrace?: {
      frames: Array<{
        filename: string;
        function: string;
        lineno: number;
        colno: number;
      }>;
    };
  };
}

export interface ErrorIntegration {
  name: string;
  setup(config: ErrorReportConfig): void;
  captureException(error: Error, context?: any): void;
  captureMessage(message: string, level?: string): void;
  setUser(user: any): void;
  setTag(key: string, value: string): void;
  setContext(key: string, context: any): void;
}

class SentryIntegration implements ErrorIntegration {
  name = 'sentry';
  private Sentry: any = null;

  setup(config: ErrorReportConfig): void {
    if (typeof window !== 'undefined' && (window as any).Sentry) {
      this.Sentry = (window as any).Sentry;
      this.Sentry.init({
        dsn: config.dsn,
        environment: config.environment,
        release: config.release,
        debug: config.debug,
        beforeSend: config.beforeSend,
      });
    }
  }

  captureException(error: Error, context?: any): void {
    if (this.Sentry) {
      this.Sentry.captureException(error, context);
    }
  }

  captureMessage(message: string, level?: string): void {
    if (this.Sentry) {
      this.Sentry.captureMessage(message, level);
    }
  }

  setUser(user: any): void {
    if (this.Sentry) {
      this.Sentry.setUser(user);
    }
  }

  setTag(key: string, value: string): void {
    if (this.Sentry) {
      this.Sentry.setTag(key, value);
    }
  }

  setContext(key: string, context: any): void {
    if (this.Sentry) {
      this.Sentry.setContext(key, context);
    }
  }
}

export class ErrorReporter {
  private config: ErrorReportConfig;
  private integration: ErrorIntegration | null = null;
  private eventQueue: ErrorEvent[] = [];
  private enabled = true;

  constructor(config: ErrorReportConfig) {
    this.config = config;
    this.setupIntegration();
  }

  private setupIntegration(): void {
    if (this.config.customIntegration) {
      this.integration = this.config.customIntegration;
    } else if (this.config.integration === 'sentry') {
      this.integration = new SentryIntegration();
    }

    if (this.integration) {
      this.integration.setup(this.config);
    }
  }

  captureError(error: Error, context?: any): void {
    if (!this.enabled) return;

    const event = this.createErrorEvent(error, context);

    if (this.config.beforeSend) {
      const processedEvent = this.config.beforeSend(event);
      if (!processedEvent) return;
    }

    if (this.integration) {
      this.integration.captureException(error, context);
    } else {
      this.eventQueue.push(event);
      this.sendEvent(event);
    }
  }

  captureMessage(message: string, level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info'): void {
    if (!this.enabled) return;

    if (this.integration) {
      this.integration.captureMessage(message, level);
    }
  }

  setUser(user: { id?: string; username?: string; email?: string }): void {
    if (this.integration) {
      this.integration.setUser(user);
    }
  }

  setTag(key: string, value: string): void {
    if (this.integration) {
      this.integration.setTag(key, value);
    }
  }

  setContext(key: string, context: any): void {
    if (this.integration) {
      this.integration.setContext(key, context);
    }
  }

  private createErrorEvent(error: Error, context?: any): ErrorEvent {
    return {
      message: error.message,
      level: 'error',
      timestamp: Date.now(),
      exception: {
        type: error.name,
        value: error.message,
        stacktrace: error.stack
          ? {
              frames: this.parseStackTrace(error.stack),
            }
          : undefined,
      },
      contexts: context,
    };
  }

  private parseStackTrace(stack: string): any[] {
    const lines = stack.split('\n').slice(1);
    return lines
      .map((line) => {
        const match = line.match(/at\s+([^\s]+)\s+\(([^)]+):(\d+):(\d+)\)/);
        if (match && match[1] && match[2] && match[3] && match[4]) {
          return {
            function: match[1],
            filename: match[2],
            lineno: parseInt(match[3]),
            colno: parseInt(match[4]),
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  private async sendEvent(event: ErrorEvent): Promise<void> {
    if (!this.config.dsn) return;

    try {
      await fetch(this.config.dsn, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });
    } catch (error) {
      console.error('Failed to send error report:', error);
    }
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

let globalReporter: ErrorReporter | null = null;

export function getErrorReporter(config?: ErrorReportConfig): ErrorReporter {
  if (!globalReporter && config) {
    globalReporter = new ErrorReporter(config);
  }
  return globalReporter!;
}

export function resetErrorReporter(): void {
  if (globalReporter) {
    globalReporter.disable();
    globalReporter = null;
  }
}
