/**
 * Console Integration
 *
 * Enhanced console with component context and filtering.
 *
 * @module devtools/enhancements/console-integration
 */

import { signal } from '../../core/reactivity/signal.js';
import { getComponentTracker } from '../../monitoring/component-tracking.js';

export interface ConsoleMessage {
  id: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  timestamp: number;
  message: string;
  args: any[];
  component?: string;
  stack?: string;
}

export interface ConsoleConfig {
  enabled?: boolean;
  maxMessages?: number;
  captureStackTrace?: boolean;
  groupByComponent?: boolean;
}

export class ConsoleIntegration {
  private config: Required<ConsoleConfig>;
  private messages = signal<ConsoleMessage[]>([]);
  private messageId = 0;
  private originalMethods: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  } | null = null;

  constructor(config: ConsoleConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxMessages: config.maxMessages ?? 1000,
      captureStackTrace: config.captureStackTrace ?? true,
      groupByComponent: config.groupByComponent ?? false,
    };

    if (this.config.enabled) {
      this.patchConsole();
    }
  }

  private patchConsole(): void {
    if (typeof console === 'undefined' || this.originalMethods) return;

    this.originalMethods = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

    console.log = (...args: any[]) => {
      this.captureMessage('log', args);
      this.originalMethods!.log.apply(console, args);
    };

    console.info = (...args: any[]) => {
      this.captureMessage('info', args);
      this.originalMethods!.info.apply(console, args);
    };

    console.warn = (...args: any[]) => {
      this.captureMessage('warn', args);
      this.originalMethods!.warn.apply(console, args);
    };

    console.error = (...args: any[]) => {
      this.captureMessage('error', args);
      this.originalMethods!.error.apply(console, args);
    };

    console.debug = (...args: any[]) => {
      this.captureMessage('debug', args);
      this.originalMethods!.debug.apply(console, args);
    };
  }

  private captureMessage(level: ConsoleMessage['level'], args: any[]): void {
    const message: ConsoleMessage = {
      id: `msg-${this.messageId++}`,
      level,
      timestamp: Date.now(),
      message: args.map((arg) => this.stringify(arg)).join(' '),
      args,
      component: this.detectComponent(),
      stack: this.config.captureStackTrace ? this.captureStack() : undefined,
    };

    const current = this.messages();
    current.push(message);

    if (current.length > this.config.maxMessages) {
      current.shift();
    }

    this.messages.set([...current]);
  }

  private stringify(value: any): string {
    if (typeof value === 'string') return value;
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private detectComponent(): string | undefined {
    const tracker = getComponentTracker();
    const components = tracker.getAllComponents();
    return components[components.length - 1];
  }

  private captureStack(): string | undefined {
    try {
      const stack = new Error().stack;
      if (stack) {
        const lines = stack.split('\n').slice(3, 6);
        return lines.join('\n');
      }
    } catch {
      return undefined;
    }
  }

  getMessages(): ConsoleMessage[] {
    return this.messages();
  }

  getMessagesByLevel(level: ConsoleMessage['level']): ConsoleMessage[] {
    return this.messages().filter((m) => m.level === level);
  }

  getMessagesByComponent(component: string): ConsoleMessage[] {
    return this.messages().filter((m) => m.component === component);
  }

  clearMessages(): void {
    this.messages.set([]);
  }

  restoreConsole(): void {
    if (!this.originalMethods) return;

    console.log = this.originalMethods.log;
    console.info = this.originalMethods.info;
    console.warn = this.originalMethods.warn;
    console.error = this.originalMethods.error;
    console.debug = this.originalMethods.debug;

    this.originalMethods = null;
  }

  dispose(): void {
    this.restoreConsole();
    this.clearMessages();
  }
}

let globalIntegration: ConsoleIntegration | null = null;

export function getConsoleIntegration(config?: ConsoleConfig): ConsoleIntegration {
  if (!globalIntegration) {
    globalIntegration = new ConsoleIntegration(config);
  }
  return globalIntegration;
}

export function resetConsoleIntegration(): void {
  if (globalIntegration) {
    globalIntegration.dispose();
    globalIntegration = null;
  }
}
