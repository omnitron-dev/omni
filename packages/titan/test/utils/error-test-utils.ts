/**
 * Error Test Utilities
 *
 * Shared utilities for testing error handling and assertions
 */

import { TitanError, ErrorCode } from '../../src/errors/index.js';

/**
 * Assert that an error is a TitanError with specific code
 *
 * @param error - The error to check
 * @param code - Expected error code
 * @param message - Optional message matcher (string or regex)
 */
export function assertTitanError(
  error: any,
  code: ErrorCode | number,
  message?: string | RegExp
): asserts error is TitanError {
  if (!TitanError.isTitanError(error)) {
    throw new Error(`Expected TitanError but got ${error?.constructor?.name || typeof error}`);
  }

  if (error.code !== code) {
    throw new Error(`Expected error code ${code} but got ${error.code}`);
  }

  if (message !== undefined) {
    if (typeof message === 'string') {
      if (error.message !== message) {
        throw new Error(`Expected message "${message}" but got "${error.message}"`);
      }
    } else if (message instanceof RegExp) {
      if (!message.test(error.message)) {
        throw new Error(`Expected message to match ${message} but got "${error.message}"`);
      }
    }
  }
}

/**
 * Expect an async operation to throw a TitanError with specific code
 *
 * @param operation - Async operation that should throw
 * @param code - Expected error code
 * @param message - Optional message matcher (string or regex)
 * @returns Promise resolving with the error
 */
export async function expectTitanError(
  operation: () => Promise<any>,
  code: ErrorCode | number,
  message?: string | RegExp
): Promise<TitanError> {
  try {
    await operation();
    throw new Error('Expected operation to throw but it succeeded');
  } catch (error) {
    assertTitanError(error, code, message);
    return error;
  }
}

/**
 * Expect a sync operation to throw a TitanError with specific code
 *
 * @param operation - Sync operation that should throw
 * @param code - Expected error code
 * @param message - Optional message matcher (string or regex)
 * @returns The thrown error
 */
export function expectTitanErrorSync(
  operation: () => any,
  code: ErrorCode | number,
  message?: string | RegExp
): TitanError {
  try {
    operation();
    throw new Error('Expected operation to throw but it succeeded');
  } catch (error) {
    assertTitanError(error, code, message);
    return error;
  }
}

/**
 * Check if error matches criteria without throwing
 *
 * @param error - Error to check
 * @param code - Expected error code
 * @param message - Optional message matcher (string or regex)
 * @returns True if error matches, false otherwise
 */
export function isTitanError(error: any, code: ErrorCode | number, message?: string | RegExp): boolean {
  if (!TitanError.isTitanError(error)) {
    return false;
  }

  if (error.code !== code) {
    return false;
  }

  if (message !== undefined) {
    if (typeof message === 'string') {
      return error.message === message;
    } else if (message instanceof RegExp) {
      return message.test(error.message);
    }
  }

  return true;
}

/**
 * Create a Jest matcher for TitanError
 *
 * Usage: expect(error).toMatchTitanError(ErrorCode.NOT_FOUND, 'Resource not found')
 */
export function createTitanErrorMatcher() {
  return {
    toMatchTitanError(received: any, code: ErrorCode | number, message?: string | RegExp) {
      const pass = isTitanError(received, code, message);

      if (pass) {
        return {
          pass: true,
          message: () =>
            `Expected error not to match TitanError with code ${code}${message ? ` and message ${message}` : ''}`,
        };
      } else {
        const errorInfo = TitanError.isTitanError(received)
          ? `TitanError(code: ${received.code}, message: "${received.message}")`
          : `${received?.constructor?.name || typeof received}`;

        return {
          pass: false,
          message: () =>
            `Expected TitanError with code ${code}${message ? ` and message ${message}` : ''} but got ${errorInfo}`,
        };
      }
    },
  };
}

/**
 * Assert that error has specific details properties
 *
 * @param error - TitanError to check
 * @param expectedDetails - Expected details properties
 */
export function assertErrorDetails(error: TitanError, expectedDetails: Record<string, any>): void {
  for (const [key, expectedValue] of Object.entries(expectedDetails)) {
    const actualValue = error.details[key];

    if (actualValue !== expectedValue) {
      throw new Error(
        `Expected error.details.${key} to be ${JSON.stringify(expectedValue)} but got ${JSON.stringify(actualValue)}`
      );
    }
  }
}

/**
 * Assert that error has specific context properties
 *
 * @param error - TitanError to check
 * @param expectedContext - Expected context properties
 */
export function assertErrorContext(error: TitanError, expectedContext: Record<string, any>): void {
  for (const [key, expectedValue] of Object.entries(expectedContext)) {
    const actualValue = error.context[key];

    if (actualValue !== expectedValue) {
      throw new Error(
        `Expected error.context.${key} to be ${JSON.stringify(expectedValue)} but got ${JSON.stringify(actualValue)}`
      );
    }
  }
}

/**
 * Create a mock error logger for testing
 *
 * @returns Mock logger with tracking
 */
export function createMockErrorLogger() {
  const errors: TitanError[] = [];
  const warnings: TitanError[] = [];
  const infos: TitanError[] = [];

  return {
    log(error: TitanError) {
      if (error.category === 'server') {
        errors.push(error);
      } else if (error.category === 'client') {
        warnings.push(error);
      } else {
        infos.push(error);
      }
    },
    getErrors: () => [...errors],
    getWarnings: () => [...warnings],
    getInfos: () => [...infos],
    clear: () => {
      errors.length = 0;
      warnings.length = 0;
      infos.length = 0;
    },
    get errorCount() {
      return errors.length;
    },
    get warningCount() {
      return warnings.length;
    },
    get infoCount() {
      return infos.length;
    },
  };
}

/**
 * Collect all errors thrown during operation
 *
 * @param operations - Array of operations to run
 * @returns Array of errors thrown
 */
export async function collectErrors(operations: Array<() => Promise<any>>): Promise<TitanError[]> {
  const errors: TitanError[] = [];

  for (const operation of operations) {
    try {
      await operation();
    } catch (error) {
      if (TitanError.isTitanError(error)) {
        errors.push(error);
      }
    }
  }

  return errors;
}
