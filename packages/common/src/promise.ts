import { entries } from "./entries";
import { noop, truly } from "./primitives";
import { isNumber, isPromise, isFunction } from "./predicates";

// Define the Deferred type
export type Deferred = {
  resolve?: (value: any) => void;
  reject?: (reason?: any) => void;
  promise?: Promise<any>;
};

/**
 * @typedef Deferred
 * @property {Function} resolve
 * @property {Function} reject
 * @property {Promise} promise
 */

/**
 * Creates a promise and returns an interface to control the state
 *
 * @returns {Deferred} An object containing the promise and methods to resolve or reject it
 */
export const defer = (): Deferred => {
  const deferred: Deferred = {};

  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });

  return deferred;
};

/**
 * Returns a promise that will be resolved after given milliseconds
 *
 * @template T
 * @param {number} ms delay in milliseconds
 * @param {T} [value] resolving value
 * @param {object} [options] Additional options
 * @param {boolean} [options.unref] Whether to allow the process to exit if only the timeout remains
 * @returns {Promise<T>} A promise that resolves with the given value after the specified delay
 */
export const delay = <T>(ms: number, value?: T, options?: { unref?: boolean }): Promise<T> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms, value);
    if (options?.unref && typeof (timer as any).unref === "function") {
      (timer as any).unref();
    }
  });

interface TimeoutOptions {
  unref?: boolean;
  signal?: AbortSignal;
}

/**
 * Creates a promise that will be rejected after given milliseconds if the given promise is not fulfilled
 * 
 * @template T Type of the promise result
 * @param {Promise<T>} promise Promise to wrap
 * @param {number} ms Timeout in milliseconds
 * @param {TimeoutOptions} [options] Additional options
 * @param {boolean} [options.unref] Whether to allow the process to exit if only the timeout remains
 * @param {AbortSignal} [options.signal] AbortSignal to cancel the timeout
 * @returns {Promise<T>} Promise that will be rejected if the timeout is exceeded
 * @throws {TypeError} If the first argument is not a promise or timeout is invalid
 * @example
 * ```typescript
 * // Basic usage
 * const result = await timeout(fetch('https://api.example.com'), 5000);
 * 
 * // With unref option
 * const result = await timeout(longOperation(), 1000, { unref: true });
 * 
 * // With abort signal
 * const controller = new AbortController();
 * const result = await timeout(fetch('https://api.example.com'), 5000, { 
 *   signal: controller.signal 
 * });
 * // Later...
 * controller.abort();
 * ```
 */
export const timeout = <T>(
  promise: Promise<T>,
  ms: number,
  options: TimeoutOptions = {}
): Promise<T> => {
  if (!isPromise(promise)) {
    throw new TypeError("The first argument must be a promise");
  }
  if (!isNumber(ms) || ms <= 0) {
    throw new TypeError("Timeout must be a positive number");
  }

  return new Promise<T>((resolve, reject) => {
    let timeoutId: NodeJS.Timeout | null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('Timeout aborted'));
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout of ${ms}ms exceeded`));
    }, ms);

    if (options.unref && typeof timeoutId.unref === 'function') {
      timeoutId.unref();
    }

    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
};

/**
 * Converts a promise to node.js style callback
 *
 * @param {Promise} promise The promise to convert
 * @param {Function} cb The callback function
 * @returns {Promise} The original promise
 */
export const nodeify = <T>(promise: Promise<T>, cb: (err: any, result?: T) => void): Promise<T> => {
  if (!isPromise(promise)) {
    throw new TypeError("The first argument must be a promise");
  }
  if (!isFunction(cb)) {
    return promise;
  }
  promise.then(
    (x) => {
      cb(null, x);
    },
    (y) => {
      cb(y);
    }
  );
  return promise;
};

/**
 * Converts a function that returns promises to a node.js style callback function
 *
 * @param {Function} fn Function to convert
 * @returns {Function} The converted function
 */
export const callbackify = <T>(fn: (...args: any[]) => Promise<T>): (...args: any[]) => any => {
  if (!isFunction(fn)) {
    throw new TypeError("The first argument must be a function");
  }
  return function _(this: any, ...args: any[]) {
    if (args.length && isFunction(args[args.length - 1])) {
      const cb = args.pop();
      return nodeify(fn.apply(this, args), cb);
    }
    return fn.apply(this, args);
  };
};

/**
 * Helper function to process a function with a callback
 *
 * @param {Function} fn Function to process
 * @param {any} context Context to bind to the function
 * @param {any[]} args Arguments to pass to the function
 * @param {boolean} multiArgs Whether to handle multiple arguments
 * @param {Function} resolve Resolve function of the promise
 * @param {Function} reject Reject function of the promise
 */
const processFn = (
  fn: (...args: any[]) => void,
  context: any,
  args: any[],
  multiArgs: boolean,
  resolve: (value?: any) => void,
  reject: (reason?: any) => void
) => {
  if (multiArgs) {
    args.push((...result: any[]) => {
      if (result[0]) {
        reject(result);
      } else {
        result.shift();
        resolve(result);
      }
    });
  } else {
    args.push((err: any, result: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  }
  fn.apply(context, args);
};

/**
 * Converts a callback function to a promise-based function
 *
 * @param {Function} fn The function to convert
 * @param {object} [options] Options to configure the promisified function
 * @param {any} [options.context] Context to bind to the function
 * @param {boolean} [options.multiArgs] Whether to handle multiple arguments
 * @returns {Function} The promisified function
 */
export const promisify = (
  fn: (...args: any[]) => void,
  options?: { context?: any; multiArgs?: boolean }
): (...args: any[]) => Promise<any> => {
  if (!isFunction(fn)) {
    throw new TypeError("The first argument must be a function");
  }

  return options && options.context
    ? (...args: any[]) =>
      new Promise((resolve, reject) => {
        processFn(fn, options.context, args, options && Boolean(options.multiArgs), resolve, reject);
      })
    : function _(this: any, ...args: any[]) {
      return new Promise((resolve, reject) => {
        processFn(fn, this, args, Boolean(options?.multiArgs), resolve, reject);
      });
    };
};

/**
 * Promisifies entire object
 *
 * @param {object} source The object to promisify
 * @param {object} [options] Options to configure the promisified functions
 * @param {string} [options.suffix] Suffix to append to the promisified function names
 * @param {Function} [options.filter] Filter function to determine which functions to promisify
 * @param {any} [options.context] Context to bind to the functions
 * @returns {object} Object with promisified functions
 */
export const promisifyAll = (
  source: any,
  options?: { suffix?: string; filter?: (key: string) => boolean; context?: any }
): any => {
  const suffix = options && options.suffix ? options.suffix : "Async";
  const filter = options && typeof options.filter === "function" ? options.filter : truly;

  if (isFunction(source)) {
    return promisify(source, options);
  }

  const target = Object.create(source);

  for (const [key, value] of entries(source, { all: true })) {
    if (isFunction(value) && filter(key)) {
      target[`${key}${suffix}`] = promisify(value, options);
    }
  }
  return target;
};

/**
 * Executes function after promise fulfillment
 *
 * @param {Promise} promise The promise to wrap
 * @param {Function} onFinally The callback to call
 * @returns {Promise} A promise that will be fulfilled using the original value
 */
const _finally = <T>(promise: Promise<T>, onFinally: () => void): Promise<T> => {
  onFinally = onFinally || noop;

  return promise.then(
    (val) =>
      new Promise((resolve) => {
        resolve(onFinally());
      }).then(() => val),
    (err) =>
      new Promise((resolve) => {
        resolve(onFinally());
      }).then(() => {
        throw err;
      })
  );
};

export { _finally as finally };

export interface RetryOptions {
  max: number;
  timeout?: number;
  match?: Array<string | RegExp | (new (...args: any[]) => any)>;
  backoffBase?: number;
  backoffExponent?: number;
  report?: (message: string, options: any, error?: Error) => void;
  name?: string;
  $current?: number;
}

/**
 * Retries a function until it succeeds or the maximum number of attempts is reached
 *
 * @param {Function} callback The function to retry
 * @param {RetryOptions|number} options Options to configure the retry behavior or the maximum number of attempts
 * @returns {Promise} A promise that resolves with the result of the function or rejects with the last error
 * @throws {Error} If the callback or options are not provided
 */
export const retry = async <T>(
  callback: (options: { current: number }) => Promise<T> | T,
  options: RetryOptions | number
): Promise<T> => {
  if (!callback || !options) {
    throw new Error("requires a callback and an options set or a number");
  }

  const opts: RetryOptions = isNumber(options) ? { max: options as number } : options as RetryOptions;

  const config = {
    $current: opts.$current || 1,
    max: opts.max,
    timeout: opts.timeout,
    match: Array.isArray(opts.match) ? opts.match : opts.match ? [opts.match] : [],
    backoffBase: opts.backoffBase ?? 100,
    backoffExponent: opts.backoffExponent || 1.1,
    report: opts.report || null,
    name: opts.name || callback.name || "unknown"
  };

  const shouldRetry = (error: Error, attempt: number): boolean => {
    if (attempt >= config.max) return false;

    if (config.match.length === 0) return true;

    return config.match.some(match =>
      match === error.toString() ||
      match === error.message ||
      (isFunction(match) && error instanceof (match as new (...args: any[]) => any)) ||
      (match instanceof RegExp && (match.test(error.message) || match.test(error.toString())))
    );
  };

  let lastError: Error | null = null;

  while (true) {
    try {
      if (config.report) {
        config.report(`Attempt ${config.name} #${config.$current}`, config);
      }

      let result = callback({ current: config.$current });

      if (isPromise(result)) {
        if (config.timeout) {
          result = await timeout(result as Promise<T>, config.timeout);
        } else {
          result = await result;
        }
      }

      if (config.report) {
        config.report(`Success ${config.name} #${config.$current}`, config);
      }

      return result;
    } catch (error: any) {
      lastError = error;

      if (config.report) {
        config.report(`Failed ${config.name} #${config.$current}: ${error.toString()}`, config, error);
      }

      if (!shouldRetry(error, config.$current)) {
        throw lastError;
      }

      const retryDelay = Math.floor(
        config.backoffBase * Math.pow(config.backoffExponent ?? 1.1, config.$current - 1)
      );

      config.$current++;

      if (retryDelay > 0) {
        if (config.report) {
          config.report(`Delaying retry of ${config.name} by ${retryDelay}ms`, config);
        }
        await delay(retryDelay);
      }
    }
  }
};

/**
 * Resolves an object of promises
 *
 * @param {object} obj Object with promises
 * @returns {Promise<object>} Object with resolved values
 */
export const props = async (obj: any): Promise<any> => {
  const result: any = {};
  await Promise.all(
    Object.keys(obj).map(async (key) => {
      Object.defineProperty(result, key, {
        enumerable: true,
        value: await obj[key],
      });
    })
  );
  return result;
};

/**
 * Tries to execute a function and resolves its result
 *
 * @param {Function} fn Function to execute
 * @param {...any} args Arguments to pass to the function
 * @returns {Promise<any>} A promise that resolves with the result of the function
 */
const try_ = (fn: (...args: any[]) => any, ...args: any[]): Promise<any> =>
  new Promise((resolve) => {
    resolve(fn(...args));
  });

export { try_ as try };

/**
 * Universalifies a function to support both callback and promise styles
 *
 * @param {Function} fn Function to universalify
 * @returns {Function} The universalified function
 */
export const universalify = (fn: (...args: any[]) => void): (...args: any[]) => any =>
  Object.defineProperties(
    function _(this: any, ...args: any[]) {
      if (isFunction(args[args.length - 1])) {
        return fn.apply(this, args);
      }
      return new Promise((resolve, reject) => {
        args.push((err: any, res: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(res);
          }
        });
        fn.apply(this, args);
      });
    },
    {
      name: {
        value: fn.name,
      },
      ...Object.keys(fn).reduce((props_, k) => {
        (props_ as any)[k] = {
          enumerable: true,
          value: (fn as any)[k],
        };
        return props_;
      }, {}),
    }
  );

/**
 * Universalifies a promise-returning function to support both callback and promise styles
 *
 * @param {Function} fn Function to universalify
 * @returns {Function} The universalified function
 */
export const universalifyFromPromise = (fn: (...args: any[]) => Promise<any>): (...args: any[]) => any =>
  Object.defineProperty(
    function _(this: any, ...args: any[]) {
      const cb = args[args.length - 1];
      if (!isFunction(cb)) {
        return fn.apply(this, args);
      }
      return fn.apply(this, args).then((r: any) => cb(null, r), cb);
    },
    "name",
    { value: fn.name }
  );
