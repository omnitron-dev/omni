/**
 * Generic testing error utilities
 */

export class TestingError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'TestingError';
  }
}

export class TimeoutError extends TestingError {
  constructor(operation: string, timeout: number) {
    super(`Timeout waiting for: ${operation} (${timeout}ms)`, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}

export class NotFoundError extends TestingError {
  constructor(entity: string, identifier?: string) {
    super(`Not found: ${entity}${identifier ? ` (${identifier})` : ''}`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class RetryError extends TestingError {
  constructor(
    message: string,
    public attempts: number,
    public lastError?: Error
  ) {
    super(message, 'RETRY_EXHAUSTED');
    this.name = 'RetryError';
  }
}
