/**
 * Error Tracking Module
 *
 * Captures errors with stack traces, breadcrumbs, and context information.
 * Integrates with Error Boundary components for automatic error capture.
 */

import type { ErrorInfo, Breadcrumb, UserInfo, ErrorTrackingConfig } from './types.js';

/**
 * Error event callback
 */
type ErrorCallback = (error: Error, info: ErrorInfo) => void;

/**
 * Error tracker class
 */
export class ErrorTracker {
  private config: ErrorTrackingConfig;
  private breadcrumbs: Breadcrumb[] = [];
  private callbacks: Set<ErrorCallback> = new Set();
  private userInfo: UserInfo | null = null;
  private context: Map<string, any> = new Map();
  private errorCount: Map<string, number> = new Map();

  constructor(config: ErrorTrackingConfig = {}) {
    this.config = {
      autoCapture: true,
      maxBreadcrumbs: 100,
      attachStackTrace: true,
      attachComponentStack: true,
      grouping: 'auto',
      sampleRate: 1,
      ...config,
    };

    if (typeof window !== 'undefined' && this.shouldSample()) {
      this.init();
    }
  }

  /**
   * Initialize error tracking
   */
  private init(): void {
    if (this.config.autoCapture) {
      this.captureGlobalErrors();
      this.captureUnhandledRejections();
      this.captureConsoleErrors();
    }
  }

  /**
   * Check if should sample
   */
  private shouldSample(): boolean {
    return Math.random() < (this.config.sampleRate || 1);
  }

  /**
   * Capture global errors
   */
  private captureGlobalErrors(): void {
    window.addEventListener('error', (event) => {
      const error = event.error || new Error(event.message);
      this.trackError(error, {
        message: event.message,
        severity: 'error',
        context: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    });
  }

  /**
   * Capture unhandled promise rejections
   */
  private captureUnhandledRejections(): void {
    window.addEventListener('unhandledrejection', (event) => {
      const rejectionError = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      this.trackError(rejectionError, {
        message: rejectionError.message,
        severity: 'error',
        context: {
          type: 'unhandledrejection',
          reason: event.reason,
        },
      });
    });
  }

  /**
   * Capture console errors
   */
  private captureConsoleErrors(): void {
    const originalError = console.error;
    console.error = (...args: any[]) => {
      this.addBreadcrumb({
        type: 'console',
        category: 'console',
        message: args.map((arg) => String(arg)).join(' '),
        level: 'error',
        timestamp: Date.now(),
      });
      originalError.apply(console, args);
    };

    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      this.addBreadcrumb({
        type: 'console',
        category: 'console',
        message: args.map((arg) => String(arg)).join(' '),
        level: 'warn',
        timestamp: Date.now(),
      });
      originalWarn.apply(console, args);
    };
  }

  /**
   * Track error
   */
  trackError(error: Error, info?: Partial<ErrorInfo>): void {
    const errorInfo: ErrorInfo = {
      message: error.message,
      name: error.name,
      stack: this.config.attachStackTrace ? error.stack : undefined,
      severity: info?.severity || 'error',
      fingerprint: this.generateFingerprint(error, info),
      context: {
        ...Object.fromEntries(this.context),
        ...info?.context,
      },
      user: info?.user !== undefined ? info.user : this.userInfo,
      breadcrumbs: [...this.breadcrumbs],
      tags: info?.tags,
      timestamp: Date.now(),
      componentStack: info?.componentStack,
    };

    // Track error count
    const key = errorInfo.fingerprint?.join(':') || error.message;
    this.errorCount.set(key, (this.errorCount.get(key) || 0) + 1);

    // Add error to breadcrumbs
    this.addBreadcrumb({
      type: 'error',
      category: 'error',
      message: errorInfo.message,
      level: 'error',
      timestamp: Date.now(),
      data: {
        name: error.name,
        stack: error.stack,
      },
    });

    // Notify callbacks
    this.notifyCallbacks(error, errorInfo);

    // Emit error event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('aether:error', {
          detail: { error, info: errorInfo },
        })
      );
    }
  }

  /**
   * Generate error fingerprint for grouping
   */
  private generateFingerprint(error: Error, info?: Partial<ErrorInfo>): string[] {
    if (info?.fingerprint) {
      return info.fingerprint;
    }

    if (this.config.grouping === 'fingerprint') {
      return [error.name, error.message];
    }

    // Auto grouping based on stack trace
    const fingerprint: string[] = [error.name];

    if (error.stack) {
      // Extract first meaningful stack frame
      const stackLines = error.stack.split('\n').slice(1);
      for (const line of stackLines) {
        const match = line.match(/at\s+([^\s]+)\s+\(([^)]+)\)/);
        if (match && match[1] && match[2]) {
          fingerprint.push(match[1]); // Function name
          const location = match[2].split(':').slice(0, -1).join(':'); // File:line
          fingerprint.push(location);
          break;
        }
      }
    }

    if (fingerprint.length === 1) {
      fingerprint.push(error.message);
    }

    return fingerprint;
  }

  /**
   * Add breadcrumb
   */
  addBreadcrumb(breadcrumb: Breadcrumb): void {
    this.breadcrumbs.push(breadcrumb);

    // Trim breadcrumbs
    if (this.breadcrumbs.length > this.config.maxBreadcrumbs!) {
      this.breadcrumbs.shift();
    }
  }

  /**
   * Set user information
   */
  setUser(user: UserInfo | null): void {
    this.userInfo = user;
  }

  /**
   * Set context
   */
  setContext(key: string, value: any): void {
    this.context.set(key, value);
  }

  /**
   * Remove context
   */
  removeContext(key: string): void {
    this.context.delete(key);
  }

  /**
   * Clear context
   */
  clearContext(): void {
    this.context.clear();
  }

  /**
   * Subscribe to errors
   */
  onError(callback: ErrorCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Notify callbacks
   */
  private notifyCallbacks(error: Error, info: ErrorInfo): void {
    this.callbacks.forEach((callback) => {
      try {
        callback(error, info);
      } catch (err) {
        console.error('Error callback failed:', err);
      }
    });
  }

  /**
   * Get error count
   */
  getErrorCount(fingerprint?: string): number {
    if (fingerprint) {
      return this.errorCount.get(fingerprint) || 0;
    }
    return Array.from(this.errorCount.values()).reduce((sum, count) => sum + count, 0);
  }

  /**
   * Clear breadcrumbs
   */
  clearBreadcrumbs(): void {
    this.breadcrumbs = [];
  }

  /**
   * Get breadcrumbs
   */
  getBreadcrumbs(): Breadcrumb[] {
    return [...this.breadcrumbs];
  }

  /**
   * Reset tracker
   */
  reset(): void {
    this.breadcrumbs = [];
    this.context.clear();
    this.errorCount.clear();
    this.callbacks.clear();
  }
}

/**
 * Error boundary integration
 */
export class ErrorBoundaryIntegration {
  private tracker: ErrorTracker;

  constructor(tracker: ErrorTracker) {
    this.tracker = tracker;
  }

  /**
   * Handle error boundary error
   */
  onError(error: Error, errorInfo: any): void {
    this.tracker.trackError(error, {
      message: error.message,
      severity: 'error',
      componentStack: errorInfo.componentStack,
      context: {
        type: 'react-error-boundary',
      },
    });
  }

  /**
   * Create error boundary handler
   */
  createHandler(): (error: Error, errorInfo: any) => void {
    return (error, errorInfo) => this.onError(error, errorInfo);
  }
}

/**
 * Source map support for better stack traces
 */
export class SourceMapSupport {
  private sourceMaps: Map<string, any> = new Map();

  /**
   * Load source map
   */
  async loadSourceMap(url: string): Promise<void> {
    try {
      const response = await fetch(`${url}.map`);
      if (response.ok) {
        const sourceMap = await response.json();
        this.sourceMaps.set(url, sourceMap);
      }
    } catch (error) {
      console.warn(`Failed to load source map for ${url}:`, error);
    }
  }

  /**
   * Enhance stack trace with source maps
   */
  enhanceStackTrace(stack: string): string {
    // This is a simplified implementation
    // In production, you'd use a proper source-map library
    return stack;
  }
}

/**
 * Global error tracker instance
 */
let globalErrorTracker: ErrorTracker | null = null;

/**
 * Get or create global error tracker
 */
export function getErrorTracker(config?: ErrorTrackingConfig): ErrorTracker {
  if (!globalErrorTracker) {
    globalErrorTracker = new ErrorTracker(config);
  }
  return globalErrorTracker;
}

/**
 * Reset global error tracker
 */
export function resetErrorTracker(): void {
  if (globalErrorTracker) {
    globalErrorTracker.reset();
    globalErrorTracker = null;
  }
}

/**
 * Error grouping utilities
 */
export const ErrorGrouping = {
  /**
   * Group errors by message
   */
  byMessage(error: Error): string {
    return error.message;
  },

  /**
   * Group errors by stack trace
   */
  byStackTrace(error: Error): string {
    if (!error.stack) return error.message;
    const lines = error.stack.split('\n').slice(0, 3);
    return lines.join('\n');
  },

  /**
   * Group errors by type
   */
  byType(error: Error): string {
    return error.name || 'Error';
  },

  /**
   * Custom grouping function
   */
  custom(error: Error, fn: (error: Error) => string): string {
    return fn(error);
  },
};
