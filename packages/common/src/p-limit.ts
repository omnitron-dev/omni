/**
 * Optimized p-limit implementation for controlling promise concurrency
 * Works in Node.js, Bun, and browser environments
 */

/**
 * Lightweight queue implementation optimized for p-limit usage
 */
class Queue<T> {
  private head?: Node<T>;
  private tail?: Node<T>;
  private _size = 0;

  enqueue(value: T): void {
    const node = { value, next: undefined } as Node<T>;
    if (this.tail) {
      this.tail.next = node;
      this.tail = node;
    } else {
      this.head = this.tail = node;
    }
    this._size++;
  }

  dequeue(): T | undefined {
    const node = this.head;
    if (!node) return undefined;

    this.head = node.next;
    if (!this.head) {
      this.tail = undefined;
    }
    this._size--;
    return node.value;
  }

  clear(): void {
    this.head = this.tail = undefined;
    this._size = 0;
  }

  get size(): number {
    return this._size;
  }
}

interface Node<T> {
  value: T;
  next?: Node<T>;
}

export interface PLimitFunction {
  /**
   * The number of promises that are currently running
   */
  readonly activeCount: number;

  /**
   * The number of promises that are waiting to run
   */
  readonly pendingCount: number;

  /**
   * Get or set the concurrency limit
   */
  concurrency: number;

  /**
   * Discard pending promises that are waiting to run
   */
  clearQueue: () => void;

  /**
   * Process an array of inputs with limited concurrency
   */
  map: <Input, ReturnType>(
    array: readonly Input[],
    mapperFunction: (input: Input, index: number) => PromiseLike<ReturnType> | ReturnType
  ) => Promise<ReturnType[]>;

  /**
   * Run a function with limited concurrency
   */
  <Arguments extends unknown[], ReturnType>(
    function_: (...arguments_: Arguments) => PromiseLike<ReturnType> | ReturnType,
    ...arguments_: Arguments
  ): Promise<ReturnType>;
}

export interface PLimitOptions {
  /**
   * Concurrency limit. Minimum: 1
   */
  readonly concurrency: number;
}

/**
 * Run multiple promise-returning & async functions with limited concurrency
 *
 * @param concurrency - Concurrency limit. Minimum: 1
 * @returns A limit function
 */
export function pLimit(concurrency: number): PLimitFunction {
  validateConcurrency(concurrency);

  const queue = new Queue<() => void>();
  let activeCount = 0;
  let currentConcurrency = concurrency;

  const resumeNext = (): void => {
    if (activeCount < currentConcurrency && queue.size > 0) {
      activeCount++;
      const resolveFunction = queue.dequeue();
      if (resolveFunction) {
        resolveFunction();
      }
    }
  };

  const next = (): void => {
    activeCount--;
    resumeNext();
  };

  const run = async <T>(
    function_: (...args: any[]) => T | PromiseLike<T>,
    resolve: (value: T | PromiseLike<T>) => void,
    arguments_: any[]
  ): Promise<void> => {
    // Execute the function and capture the result promise
    const result = (async () => function_(...arguments_))();

    // Resolve immediately with the promise (don't wait for completion)
    resolve(result);

    // Wait for the function to complete
    try {
      await result;
    } catch {
      // Catch errors to prevent unhandled rejections
      // The original promise rejection is preserved for the caller
    }

    // Decrement active count and process next queued function
    next();
  };

  const enqueue = <T>(
    function_: (...args: any[]) => T | PromiseLike<T>,
    resolve: (value: T | PromiseLike<T>) => void,
    arguments_: any[]
  ): void => {
    // Queue the function to run later
    queue.enqueue(() => {
      run(function_, resolve, arguments_);
    });

    // Start processing immediately if under concurrency limit
    (async () => {
      // Use microtask to ensure async execution
      await Promise.resolve();
      if (activeCount < currentConcurrency && queue.size > 0) {
        resumeNext();
      }
    })();
  };

  const generator = <Arguments extends unknown[], ReturnType>(
    function_: (...arguments_: Arguments) => PromiseLike<ReturnType> | ReturnType,
    ...arguments_: Arguments
  ): Promise<ReturnType> =>
    new Promise<ReturnType>((resolve) => {
      enqueue(function_, resolve, arguments_);
    });

  // Define properties on the generator function
  Object.defineProperties(generator, {
    activeCount: {
      get: () => activeCount,
    },
    pendingCount: {
      get: () => queue.size,
    },
    clearQueue: {
      value: () => {
        queue.clear();
      },
    },
    concurrency: {
      get: () => currentConcurrency,
      set: (newConcurrency: number) => {
        validateConcurrency(newConcurrency);
        currentConcurrency = newConcurrency;

        // Use queueMicrotask for optimal scheduling (works in all environments)
        const processQueue =
          typeof queueMicrotask !== 'undefined' ? queueMicrotask : (fn: () => void) => Promise.resolve().then(fn);

        processQueue(() => {
          while (activeCount < currentConcurrency && queue.size > 0) {
            resumeNext();
          }
        });
      },
    },
    map: {
      async value<Input, ReturnType>(
        this: PLimitFunction,
        array: readonly Input[],
        mapperFunction: (input: Input, index: number) => PromiseLike<ReturnType> | ReturnType
      ): Promise<ReturnType[]> {
        const promises = array.map((value, index) => this(mapperFunction, value, index));
        return Promise.all(promises);
      },
    },
  });

  return generator as PLimitFunction;
}

/**
 * Returns a function with limited concurrency
 *
 * @param function_ - Promise-returning/async function
 * @param options - Options including concurrency limit
 * @returns Function with limited concurrency
 */
export function limitFunction<Arguments extends unknown[], ReturnType>(
  function_: (...arguments_: Arguments) => PromiseLike<ReturnType>,
  options: PLimitOptions
): (...arguments_: Arguments) => Promise<ReturnType> {
  const { concurrency } = options;
  const limit = pLimit(concurrency);

  return (...arguments_: Arguments) => limit(() => function_(...arguments_));
}

/**
 * Validate concurrency value
 */
function validateConcurrency(concurrency: number): void {
  if (!((Number.isInteger(concurrency) || concurrency === Number.POSITIVE_INFINITY) && concurrency > 0)) {
    throw new TypeError('Expected `concurrency` to be a number from 1 and up');
  }
}

// Also export as default for compatibility
export default pLimit;

// Export Limit type for compatibility with existing code
export type Limit = PLimitFunction;
