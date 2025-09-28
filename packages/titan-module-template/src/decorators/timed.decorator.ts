/**
 * Timing Decorator
 *
 * Decorator for measuring method execution time.
 * This demonstrates how to create performance monitoring decorators.
 */

import 'reflect-metadata';
import { TEMPLATE_METADATA } from '../constants.js';

export interface TimedOptions {
  /**
   * Log level for timing output
   */
  logLevel?: 'debug' | 'info' | 'warn';

  /**
   * Warning threshold in milliseconds
   */
  warnThreshold?: number;

  /**
   * Include arguments in log
   */
  includeArgs?: boolean;

  /**
   * Include result in log
   */
  includeResult?: boolean;

  /**
   * Custom label for timing
   */
  label?: string;
}

/**
 * Measure method execution time
 */
export function Timed(options: TimedOptions = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    // Store metadata
    Reflect.defineMetadata(
      TEMPLATE_METADATA.TIMED_METHOD,
      options,
      target,
      propertyKey
    );

    const originalMethod = descriptor.value;
    const methodName = String(propertyKey);
    const className = target.constructor.name;

    descriptor.value = async function timedMethod(...args: any[]) {
      const logger = (this as any).logger;
      const label = options.label || `${className}.${methodName}`;

      const startTime = process.hrtime.bigint();

      try {
        const result = await originalMethod.apply(this, args);

        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1_000_000; // Convert to milliseconds

        // Log timing
        if (logger) {
          const logData: any = {
            method: label,
            duration: `${duration.toFixed(2)}ms`,
          };

          if (options.includeArgs) {
            logData.args = args;
          }

          if (options.includeResult) {
            logData.result = result;
          }

          const logLevel = options.logLevel || 'debug';

          if (options.warnThreshold && duration > options.warnThreshold) {
            logger.warn(`Slow method execution`, logData);
          } else {
            logger[logLevel](`Method executed`, logData);
          }
        }

        return result;
      } catch (error) {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1_000_000;

        if (logger) {
          logger.error(`Method failed`, {
            method: label,
            duration: `${duration.toFixed(2)}ms`,
            error: (error as Error).message,
          });
        }

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Timeout decorator
 */
export function Timeout(ms: number): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const methodName = String(propertyKey);

    descriptor.value = async function timeoutMethod(...args: any[]) {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Method ${methodName} timed out after ${ms}ms`));
        }, ms);
      });

      const methodPromise = originalMethod.apply(this, args);

      return Promise.race([methodPromise, timeoutPromise]);
    };

    return descriptor;
  };
}

/**
 * Throttle decorator
 */
export function Throttle(ms: number): MethodDecorator {
  const lastCall = new WeakMap<any, number>();

  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function throttledMethod(...args: any[]) {
      const now = Date.now();
      const last = lastCall.get(this) || 0;

      if (now - last < ms) {
        return null; // Or throw an error, or return cached result
      }

      lastCall.set(this, now);
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Debounce decorator
 */
export function Debounce(ms: number): MethodDecorator {
  const timers = new WeakMap<any, NodeJS.Timeout>();

  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = function debouncedMethod(...args: any[]) {
      const existing = timers.get(this);
      if (existing) {
        clearTimeout(existing);
      }

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve(originalMethod.apply(this, args));
          timers.delete(this);
        }, ms);

        timers.set(this, timer);
      });
    };

    return descriptor;
  };
}