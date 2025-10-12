/**
 * Utility Decorators for method enhancement
 *
 * @module decorators/utility
 */

import { createMethodInterceptor } from './decorator-factory.js';

/**
 * Timeout decorator - adds timeout to method execution
 */
export const Timeout = createMethodInterceptor<{ ms: number }>('Timeout', (originalMethod, args, context) => {
  const timeoutMs = context.options?.ms || 5000;

  return Promise.race([
    originalMethod(...args),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new TimeoutError(
              `Method ${context.target.constructor.name}.${String(context.propertyKey)} timed out after ${timeoutMs}ms`
            )
          ),
        timeoutMs
      )
    ),
  ]);
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

        // Log retry attempt
        console.warn(
          `Retry attempt ${attempt}/${attempts} for ${context.target.constructor.name}.${String(context.propertyKey)}`,
          { error, delay: currentDelay }
        );
      }
    }
  }

  throw lastError;
});

/**
 * Log decorator - logs method entry and exit
 */
export const Log = createMethodInterceptor<{
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  includeArgs?: boolean;
  includeResult?: boolean;
  message?: string;
}>('Log', async (originalMethod, args, context) => {
  const level = context.options?.level || 'info';
  const methodName = `${context.target.constructor.name}.${String(context.propertyKey)}`;

  const logData: any = {
    method: methodName,
    timestamp: new Date().toISOString(),
  };

  if (context.options?.includeArgs) {
    logData.args = args;
  }

  if (context.options?.message) {
    logData.message = context.options.message;
  }

  // Log method entry
  console[level](`Entering ${methodName}`, logData);

  try {
    const result = await originalMethod(...args);

    if (context.options?.includeResult) {
      logData.result = result;
    }

    // Log method exit
    console[level](`Exiting ${methodName}`, logData);

    return result;
  } catch (error) {
    logData.error = error;
    console.error(`Error in ${methodName}`, logData);
    throw error;
  }
});

/**
 * Monitor decorator - tracks method performance
 */
export const Monitor = createMethodInterceptor<{
  name?: string;
  sampleRate?: number;
  includeArgs?: boolean;
  includeResult?: boolean;
}>('Monitor', async (originalMethod, args, context) => {
  const sampleRate = context.options?.sampleRate ?? 1.0;

  // Skip monitoring based on sample rate
  if (Math.random() > sampleRate) {
    return originalMethod(...args);
  }

  const metricName = context.options?.name || `${context.target.constructor.name}.${String(context.propertyKey)}`;
  const start = performance.now();

  const metadata: any = {
    method: metricName,
    timestamp: Date.now(),
  };

  if (context.options?.includeArgs) {
    metadata.args = args;
  }

  try {
    const result = await originalMethod(...args);

    const duration = performance.now() - start;
    metadata.duration = duration;
    metadata.success = true;

    if (context.options?.includeResult) {
      metadata.result = result;
    }

    // Log metrics (in real implementation, would send to metrics system)
    console.debug('Method metrics', metadata);

    return result;
  } catch (error) {
    const duration = performance.now() - start;
    metadata.duration = duration;
    metadata.success = false;
    metadata.error = error;

    console.error('Method error metrics', metadata);

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
