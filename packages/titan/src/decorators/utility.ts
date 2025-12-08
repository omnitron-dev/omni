/**
 * Utility Decorators for method enhancement
 *
 * @module decorators/utility
 */

import { createMethodInterceptor } from './decorator-factory.js';
import type { ILogger } from '../modules/logger/logger.types.js';

/**
 * Get logger from instance if available.
 * Looks for common logger property names on the class instance.
 */
function getInstanceLogger(instance: any): ILogger | undefined {
  return instance.logger || instance._logger || instance.log;
}

/**
 * Timeout decorator - adds timeout to method execution
 */
export const Timeout = createMethodInterceptor<{ ms: number }>('Timeout', async (originalMethod, args, context) => {
  const timeoutMs = context.options?.ms || 5000;
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () =>
        reject(
          new TimeoutError(
            `Method ${context.target.constructor.name}.${String(context.propertyKey)} timed out after ${timeoutMs}ms`
          )
        ),
      timeoutMs
    );
  });

  try {
    const result = await Promise.race([originalMethod(...args), timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
});

/**
 * Retryable decorator with exponential backoff
 */
export const Retryable = createMethodInterceptor<{
  attempts?: number;
  delay?: number;
  maxDelay?: number;
  backoff?: number;
  retryOn?: (error: any) => boolean;
}>('Retryable', async (originalMethod, args, context) => {
  const { attempts = 3, delay = 1000, maxDelay = 30000, backoff = 2, retryOn } = context.options || {};

  let lastError: any;
  let currentDelay = delay;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await originalMethod(...args);
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (retryOn && !retryOn(error)) {
        throw error;
      }

      if (attempt < attempts) {
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, currentDelay));

        // Apply exponential backoff
        currentDelay = Math.min(currentDelay * backoff, maxDelay);

        // Log retry attempt if logger available
        const logger = getInstanceLogger(context.target);
        logger?.warn(
          {
            attempt,
            maxAttempts: attempts,
            method: `${context.target.constructor.name}.${String(context.propertyKey)}`,
            err: error,
            nextDelay: currentDelay,
          },
          `Retry attempt ${attempt}/${attempts}`
        );
      }
    }
  }

  throw lastError;
});

/**
 * Log decorator - logs method entry and exit
 * Uses instance logger if available (via logger, _logger, or log property)
 */
export const Log = createMethodInterceptor<{
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  includeArgs?: boolean;
  includeResult?: boolean;
  message?: string;
}>('Log', async (originalMethod, args, context) => {
  const logger = getInstanceLogger(context.target);

  // Skip logging if no logger available
  if (!logger) {
    return originalMethod(...args);
  }

  const level = context.options?.level || 'info';
  const methodName = `${context.target.constructor.name}.${String(context.propertyKey)}`;

  const logData: Record<string, unknown> = {
    method: methodName,
  };

  if (context.options?.includeArgs) {
    logData['args'] = args;
  }

  if (context.options?.message) {
    logData['customMessage'] = context.options.message;
  }

  // Log method entry
  logger[level](logData, `Entering ${methodName}`);

  try {
    const result = await originalMethod(...args);

    if (context.options?.includeResult) {
      logData['result'] = result;
    }

    // Log method exit
    logger[level](logData, `Exiting ${methodName}`);

    return result;
  } catch (error) {
    logData['err'] = error;
    logger.error(logData, `Error in ${methodName}`);
    throw error;
  }
});

/**
 * Monitor decorator - tracks method performance
 * Uses instance logger if available (via logger, _logger, or log property)
 */
export const Monitor = createMethodInterceptor<{
  name?: string;
  sampleRate?: number;
  includeArgs?: boolean;
  includeResult?: boolean;
}>('Monitor', async (originalMethod, args, context) => {
  const logger = getInstanceLogger(context.target);
  const sampleRate = context.options?.sampleRate ?? 1.0;

  // Skip monitoring based on sample rate or if no logger
  if (Math.random() > sampleRate || !logger) {
    return originalMethod(...args);
  }

  const metricName = context.options?.name || `${context.target.constructor.name}.${String(context.propertyKey)}`;
  const start = performance.now();

  const metadata: Record<string, unknown> = {
    method: metricName,
    timestamp: Date.now(),
  };

  if (context.options?.includeArgs) {
    metadata['args'] = args;
  }

  try {
    const result = await originalMethod(...args);

    const duration = performance.now() - start;
    metadata['durationMs'] = duration;
    metadata['success'] = true;

    if (context.options?.includeResult) {
      metadata['result'] = result;
    }

    // Log metrics
    logger.debug(metadata, 'Method metrics');

    return result;
  } catch (error) {
    const duration = performance.now() - start;
    metadata['durationMs'] = duration;
    metadata['success'] = false;
    metadata['err'] = error;

    logger.error(metadata, 'Method error metrics');

    throw error;
  }
});

/**
 * Timeout error class
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
