/**
 * Deferred promise utilities for async testing
 */

/**
 * Promise with deferred resolution/rejection
 *
 * Allows external control of promise resolution, useful for testing
 * async flows and coordinating multiple asynchronous operations.
 *
 * @example
 * ```ts
 * const deferred = new DeferredPromise<string>();
 * setTimeout(() => deferred.resolve('done'), 1000);
 * const result = await deferred.promise; // 'done'
 * ```
 */
export class DeferredPromise<T> {
  public promise: Promise<T>;
  public resolve!: (value: T) => void;
  public reject!: (error: Error) => void;
  private settled = false;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = (value: T) => {
        if (!this.settled) {
          this.settled = true;
          resolve(value);
        }
      };

      this.reject = (error: Error) => {
        if (!this.settled) {
          this.settled = true;
          reject(error);
        }
      };
    });
  }

  /**
   * Check if the promise has been settled (resolved or rejected)
   */
  get isSettled(): boolean {
    return this.settled;
  }
}

/**
 * Create a deferred promise (factory function)
 *
 * @example
 * ```ts
 * const deferred = createDeferred<number>();
 * deferred.resolve(42);
 * ```
 */
export function createDeferred<T>(): DeferredPromise<T> {
  return new DeferredPromise<T>();
}

/**
 * Deferred interface (lightweight version)
 *
 * Provides external control over promise resolution without
 * the overhead of a class instance.
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

/**
 * Create a deferred promise with minimal overhead
 *
 * This is a lightweight alternative to DeferredPromise class,
 * maintaining backward compatibility with existing code.
 *
 * @example
 * ```ts
 * const deferred = defer<string>();
 * setTimeout(() => deferred.resolve('done'), 100);
 * await deferred.promise;
 * ```
 */
export function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
