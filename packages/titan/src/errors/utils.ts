/**
 * Utility functions for error handling
 */

import { TitanError } from './core.js';
import { ErrorCode } from './codes.js';
import type { Contract } from '../validation/contract.js';

/**
 * Error handler type
 */
export type ErrorHandlerFunction = (error: TitanError) => void | Promise<void>;

/**
 * Error filter type
 */
export type ErrorFilter = (error: TitanError) => boolean;

/**
 * Error transformer type
 */
export type ErrorTransformer = (error: TitanError) => TitanError;

/**
 * Error recovery function
 */
export type ErrorRecovery<T> = (error: TitanError) => T | Promise<T>;

/**
 * Try-catch wrapper with TitanError conversion
 */
export async function tryAsync<T>(
  fn: () => Promise<T>,
  errorCode: ErrorCode = ErrorCode.INTERNAL_ERROR
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (TitanError.isTitanError(error)) {
      throw error;
    }

    throw new TitanError({
      code: errorCode,
      message: error instanceof Error ? error.message : String(error),
      cause: error
    });
  }
}

/**
 * Try-catch wrapper for sync functions
 */
export function trySync<T>(
  fn: () => T,
  errorCode: ErrorCode = ErrorCode.INTERNAL_ERROR
): T {
  try {
    return fn();
  } catch (error) {
    if (TitanError.isTitanError(error)) {
      throw error;
    }

    throw new TitanError({
      code: errorCode,
      message: error instanceof Error ? error.message : String(error),
      cause: error
    });
  }
}

/**
 * Error handler with recovery
 */
export async function handleError<T>(
  fn: () => Promise<T>,
  handlers: {
    [K in ErrorCode]?: ErrorRecovery<T>;
  } & {
    default?: ErrorRecovery<T>;
  }
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const titanError = TitanError.isTitanError(error)
      ? error
      : new TitanError({
          code: ErrorCode.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : String(error),
          cause: error
        });

    const handler = handlers[titanError.code as ErrorCode] || handlers.default;

    if (handler) {
      return await handler(titanError);
    }

    throw titanError;
  }
}

/**
 * Chain multiple error handlers
 */
export class ErrorHandlerChain {
  private handlers: Array<{
    filter?: ErrorFilter;
    handler: ErrorHandlerFunction;
  }> = [];

  /**
   * Add a handler
   */
  add(handler: ErrorHandlerFunction, filter?: ErrorFilter): this {
    this.handlers.push({ handler, filter });
    return this;
  }

  /**
   * Add a handler for specific error code
   */
  addForCode(code: ErrorCode, handler: ErrorHandlerFunction): this {
    return this.add(handler, error => error.code === code);
  }

  /**
   * Add a handler for error category
   */
  addForCategory(category: string, handler: ErrorHandlerFunction): this {
    return this.add(handler, error => error.category === category);
  }

  /**
   * Handle an error
   */
  async handle(error: TitanError): Promise<void> {
    for (const { filter, handler } of this.handlers) {
      if (!filter || filter(error)) {
        await handler(error);
      }
    }
  }
}

/**
 * Create an error boundary
 */
export function createErrorBoundary<T>(
  defaultValue: T,
  onError?: (error: TitanError) => void
): (fn: () => T | Promise<T>) => Promise<T> {
  return async (fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (error) {
      const titanError = TitanError.isTitanError(error)
        ? error
        : new TitanError({
            code: ErrorCode.INTERNAL_ERROR,
            message: error instanceof Error ? error.message : String(error),
            cause: error
          });

      if (onError) {
        onError(titanError);
      }

      return defaultValue;
    }
  };
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    shouldRetry?: (error: TitanError, attempt: number) => boolean;
    onRetry?: (error: TitanError, attempt: number, delay: number) => void;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    shouldRetry = (error) => error.isRetryable(),
    onRetry
  } = options;

  let lastError: TitanError;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = TitanError.isTitanError(error)
        ? error
        : new TitanError({
            code: ErrorCode.INTERNAL_ERROR,
            message: error instanceof Error ? error.message : String(error),
            cause: error
          });

      if (attempt === maxAttempts || !shouldRetry(lastError, attempt)) {
        throw lastError;
      }

      if (onRetry) {
        onRetry(lastError, attempt, delay);
      }

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw lastError!;
}

/**
 * Circuit breaker for error handling
 */
export class CircuitBreaker<T> {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly options: {
      failureThreshold: number;
      resetTimeout: number;
      testRequest?: () => Promise<boolean>;
    }
  ) {}

  async execute(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should be reset
    if (
      this.state === 'open' &&
      Date.now() - this.lastFailureTime > this.options.resetTimeout
    ) {
      this.state = 'half-open';
    }

    // Circuit is open
    if (this.state === 'open') {
      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Circuit breaker is open',
        details: { failures: this.failures }
      });
    }

    try {
      const result = await fn();

      // Reset on success
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }

      return result;
    } catch (error) {
      this.lastFailureTime = Date.now();
      this.failures++;

      if (this.failures >= this.options.failureThreshold) {
        this.state = 'open';
      }

      throw error;
    }
  }

  /**
   * Get circuit state
   */
  getState(): { state: string; failures: number } {
    return {
      state: this.state,
      failures: this.failures
    };
  }

  /**
   * Reset the circuit
   */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailureTime = 0;
  }
}

/**
 * Error logger utility
 */
export class ErrorLogger {
  constructor(
    private readonly options: {
      includeStack?: boolean;
      includeContext?: boolean;
      filter?: (error: TitanError) => boolean;
      logger?: {
        error: (message: string, data?: any) => void;
        warn: (message: string, data?: any) => void;
        info: (message: string, data?: any) => void;
      };
    } = {}
  ) {}

  log(error: TitanError): void {
    if (this.options.filter && !this.options.filter(error)) {
      return;
    }

    const logger = this.options.logger || console;
    const data = {
      code: error.code,
      category: error.category,
      details: error.details,
      ...(this.options.includeContext && { context: error.context }),
      ...(this.options.includeStack && { stack: error.stack }),
      ...(error.requestId && { requestId: error.requestId }),
      ...(error.correlationId && { correlationId: error.correlationId })
    };

    if (error.category === 'server') {
      logger.error(error.message, data);
    } else if (error.category === 'client') {
      logger.warn(error.message, data);
    } else {
      logger.info(error.message, data);
    }
  }
}

/**
 * Create error documentation from a contract
 */
export function documentContractErrors(contract: Contract): string {
  const docs: string[] = ['# API Error Documentation\n'];

  for (const method of contract.getMethods()) {
    const methodContract = contract.getMethod(method);

    if (!methodContract?.errors) continue;

    docs.push(`## ${method}\n`);

    for (const [code, schema] of Object.entries(methodContract.errors)) {
      docs.push(`### Error ${code}\n`);

      // Try to extract description from schema
      const schemaObj = schema as any;
      if (schemaObj._def?.description) {
        docs.push(`${schemaObj._def.description}\n`);
      }

      docs.push('**Schema:**');
      docs.push('```json');
      docs.push(JSON.stringify(schemaObj.shape || schemaObj._def, null, 2));
      docs.push('```\n');
    }
  }

  return docs.join('\n');
}

/**
 * Error matcher for testing
 */
export class ErrorMatcher {
  private conditions: Array<(error: TitanError) => boolean> = [];

  /**
   * Match error code
   */
  withCode(code: ErrorCode): this {
    this.conditions.push(error => error.code === code);
    return this;
  }

  /**
   * Match error message
   */
  withMessage(message: string | RegExp): this {
    this.conditions.push(error =>
      typeof message === 'string'
        ? error.message === message
        : message.test(error.message)
    );
    return this;
  }

  /**
   * Match error details
   */
  withDetails(matcher: (details: any) => boolean): this {
    this.conditions.push(error => matcher(error.details));
    return this;
  }

  /**
   * Check if error matches
   */
  matches(error: TitanError): boolean {
    return this.conditions.every(condition => condition(error));
  }

  /**
   * Create a Jest matcher
   */
  toJestMatcher(): jest.CustomMatcher {
    return (received: any) => {
      if (!TitanError.isTitanError(received)) {
        return {
          pass: false,
          message: () => 'Expected TitanError'
        };
      }

      const pass = this.matches(received);

      return {
        pass,
        message: () =>
          pass
            ? `Expected error not to match conditions`
            : `Expected error to match conditions`
      };
    };
  }
}