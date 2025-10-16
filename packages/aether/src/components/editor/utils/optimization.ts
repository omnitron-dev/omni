/**
 * Optimization utilities for Advanced Editor
 *
 * Provides:
 * - RequestIdleCallback wrappers
 * - RAF (RequestAnimationFrame) scheduling
 * - Batching utilities
 * - Throttle and debounce helpers
 * - Intersection observer utilities
 */

/**
 * Idle callback options
 */
export interface IdleCallbackOptions {
  timeout?: number;
}

/**
 * Idle callback deadline
 */
export interface IdleDeadline {
  didTimeout: boolean;
  timeRemaining(): number;
}

/**
 * Request idle callback (with fallback)
 */
export function requestIdleCallback(
  callback: (deadline: IdleDeadline) => void,
  options?: IdleCallbackOptions
): number {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    return window.requestIdleCallback(callback, options);
  }

  // Fallback using setTimeout
  const start = Date.now();
  return setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
    });
  }, 1) as any;
}

/**
 * Cancel idle callback (with fallback)
 */
export function cancelIdleCallback(id: number): void {
  if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(id);
  } else {
    clearTimeout(id);
  }
}

/**
 * Schedule task during idle time
 */
export function scheduleIdleTask<T>(
  task: () => T,
  options?: IdleCallbackOptions
): Promise<T> {
  return new Promise((resolve) => {
    requestIdleCallback(() => {
      resolve(task());
    }, options);
  });
}

/**
 * RAF scheduler for smooth animations
 */
export class RAFScheduler {
  private callbacks = new Map<number, FrameRequestCallback>();
  private nextId = 0;

  /**
   * Schedule callback on next frame
   */
  schedule(callback: FrameRequestCallback): number {
    const id = this.nextId++;

    this.callbacks.set(id, callback);

    requestAnimationFrame((time) => {
      const cb = this.callbacks.get(id);
      if (cb) {
        cb(time);
        this.callbacks.delete(id);
      }
    });

    return id;
  }

  /**
   * Cancel scheduled callback
   */
  cancel(id: number): void {
    this.callbacks.delete(id);
  }

  /**
   * Schedule callback with delay (in frames)
   */
  scheduleDelayed(callback: FrameRequestCallback, frames: number): number {
    if (frames <= 0) {
      return this.schedule(callback);
    }

    let remaining = frames;
    const id = this.nextId++;

    const tick = (time: number): void => {
      remaining--;
      if (remaining <= 0) {
        callback(time);
        this.callbacks.delete(id);
      } else {
        requestAnimationFrame(tick);
      }
    };

    this.callbacks.set(id, tick);
    requestAnimationFrame(tick);

    return id;
  }

  /**
   * Clear all scheduled callbacks
   */
  clear(): void {
    this.callbacks.clear();
  }
}

/**
 * Batch executor for combining multiple operations
 */
export class BatchExecutor<T> {
  private queue: T[] = [];
  private timeout?: ReturnType<typeof setTimeout>;
  private rafId?: number;

  constructor(
    private executor: (items: T[]) => void,
    private options: {
      maxSize?: number;
      delay?: number;
      useRAF?: boolean;
    } = {}
  ) {}

  /**
   * Add item to batch
   */
  add(item: T): void {
    this.queue.push(item);

    // Check if we should flush immediately
    if (this.options.maxSize && this.queue.length >= this.options.maxSize) {
      this.flush();
      return;
    }

    // Schedule flush
    this.scheduleFlush();
  }

  /**
   * Schedule batch flush
   */
  private scheduleFlush(): void {
    // Clear existing schedule
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }

    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }

    // Schedule new flush
    if (this.options.useRAF) {
      this.rafId = requestAnimationFrame(() => {
        this.flush();
      });
    } else {
      this.timeout = setTimeout(() => {
        this.flush();
      }, this.options.delay || 0);
    }
  }

  /**
   * Flush batch immediately
   */
  flush(): void {
    if (this.queue.length === 0) return;

    const items = [...this.queue];
    this.queue = [];

    // Clear scheduled flush
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }

    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }

    this.executor(items);
  }

  /**
   * Clear batch without executing
   */
  clear(): void {
    this.queue = [];

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }

    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }
  }

  /**
   * Get current queue size
   */
  get size(): number {
    return this.queue.length;
  }
}

/**
 * Throttle function - limits execution rate
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): T & { cancel: () => void } {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let lastExecuted = 0;
  let lastArgs: Parameters<T> | undefined;

  const { leading = true, trailing = true } = options;

  const throttled = ((...args: Parameters<T>) => {
    const now = Date.now();
    const elapsed = now - lastExecuted;

    lastArgs = args;

    if (elapsed >= delay) {
      // Execute immediately
      if (leading) {
        lastExecuted = now;
        fn(...args);
        lastArgs = undefined;
      }
    } else {
      // Schedule execution
      if (trailing && !timeout) {
        timeout = setTimeout(() => {
          lastExecuted = Date.now();
          timeout = undefined;
          if (lastArgs) {
            fn(...lastArgs);
            lastArgs = undefined;
          }
        }, delay - elapsed);
      }
    }
  }) as T & { cancel: () => void };

  throttled.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    lastArgs = undefined;
  };

  return throttled;
}

/**
 * Debounce function - delays execution until after delay
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
  options: { leading?: boolean; trailing?: boolean; maxWait?: number } = {}
): T & { cancel: () => void; flush: () => void } {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: Parameters<T> | undefined;
  let lastCallTime = 0;

  const { leading = false, trailing = true, maxWait } = options;

  const invoke = (): void => {
    if (lastArgs) {
      fn(...lastArgs);
      lastArgs = undefined;
      lastCallTime = Date.now();
    }
  };

  const debounced = ((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;

    lastArgs = args;

    // Execute immediately on leading edge
    if (leading && (!lastCallTime || timeSinceLastCall >= delay)) {
      invoke();
      return;
    }

    // Check maxWait
    if (maxWait && timeSinceLastCall >= maxWait) {
      invoke();
      return;
    }

    // Clear existing timeout
    if (timeout) {
      clearTimeout(timeout);
    }

    // Schedule execution
    if (trailing) {
      timeout = setTimeout(() => {
        invoke();
        timeout = undefined;
      }, delay);
    }
  }) as T & { cancel: () => void; flush: () => void };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    lastArgs = undefined;
  };

  debounced.flush = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    invoke();
  };

  return debounced;
}

/**
 * Intersection observer utility
 */
export class IntersectionObserverUtil {
  private observer?: IntersectionObserver;
  private callbacks = new Map<Element, IntersectionObserverCallback>();

  constructor(private options?: IntersectionObserverInit) {
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const callback = this.callbacks.get(entry.target);
          if (callback) {
            callback([entry], this.observer!);
          }
        }
      }, options);
    }
  }

  /**
   * Observe element
   */
  observe(element: Element, callback: IntersectionObserverCallback): void {
    if (!this.observer) {
      // Fallback: call callback immediately with visible
      callback(
        [
          {
            target: element,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: element.getBoundingClientRect(),
            intersectionRect: element.getBoundingClientRect(),
            rootBounds: null,
            time: Date.now(),
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
      return;
    }

    this.callbacks.set(element, callback);
    this.observer.observe(element);
  }

  /**
   * Unobserve element
   */
  unobserve(element: Element): void {
    this.callbacks.delete(element);
    this.observer?.unobserve(element);
  }

  /**
   * Disconnect observer
   */
  disconnect(): void {
    this.callbacks.clear();
    this.observer?.disconnect();
  }
}

/**
 * Wait for element to be visible
 */
export function waitForVisible(
  element: Element,
  options?: IntersectionObserverInit
): Promise<void> {
  return new Promise((resolve) => {
    const observer = new IntersectionObserverUtil(options);
    observer.observe(element, (entries) => {
      if (entries[0].isIntersecting) {
        observer.disconnect();
        resolve();
      }
    });
  });
}

/**
 * Lazy load utility
 */
export function lazyLoad<T>(
  loader: () => Promise<T>,
  options: {
    preload?: boolean;
    timeout?: number;
  } = {}
): () => Promise<T> {
  let promise: Promise<T> | undefined;
  let result: T | undefined;

  const load = async (): Promise<T> => {
    if (result !== undefined) {
      return result;
    }

    if (!promise) {
      promise = loader();

      if (options.timeout) {
        promise = Promise.race([
          promise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Lazy load timeout')), options.timeout)
          ),
        ]);
      }
    }

    result = await promise;
    return result;
  };

  // Preload if requested
  if (options.preload) {
    scheduleIdleTask(load);
  }

  return load;
}

/**
 * Global RAF scheduler instance
 */
export const rafScheduler = new RAFScheduler();
