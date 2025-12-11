/**
 * Mock for @kysera/infra
 */

export const withRetry = jest.fn().mockImplementation(async (fn, options = {}) => {
  return fn();
});

export const createRetryWrapper = jest.fn().mockImplementation((options = {}) => {
  return async (fn: () => Promise<any>) => fn();
});

export const isTransientError = jest.fn().mockReturnValue(false);

export class CircuitBreaker {
  constructor(options: any = {}) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  isOpen(): boolean {
    return false;
  }

  getState(): string {
    return 'CLOSED';
  }

  reset(): void {}
}
