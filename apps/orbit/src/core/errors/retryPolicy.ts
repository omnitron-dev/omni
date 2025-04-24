export interface RetryPolicyOptions {
  retries: number;
  delay?: number; // milliseconds
  exponentialBackoff?: boolean;
}

export class RetryPolicy {
  constructor(private options: RetryPolicyOptions) { }

  async execute<T>(action: () => Promise<T>): Promise<T> {
    let attempts = 0;
    let lastError: any;

    while (attempts <= this.options.retries) {
      try {
        return await action();
      } catch (error) {
        lastError = error;
        attempts++;

        if (attempts > this.options.retries) {
          throw lastError;
        }

        const delay = this.calculateDelay(attempts);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private calculateDelay(attempt: number): number {
    if (this.options.exponentialBackoff) {
      return (this.options.delay || 1000) * Math.pow(2, attempt - 1);
    }
    return this.options.delay || 1000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}