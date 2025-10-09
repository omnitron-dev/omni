import { Errors } from '../errors/factories.js';

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: {
    timeout?: number;
    interval?: number;
    message?: string;
  } = {}
): Promise<void> {
  const { timeout = 5000, interval = 50, message = 'Condition not met' } = options;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await delay(interval);
  }

  throw Errors.timeout('waitFor: ' + message, timeout);
}

/**
 * Delay execution for specified milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a deferred promise
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

export function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Collect events from an event emitter
 */
export class EventCollector<T = any> {
  private events: Array<{ event: string; data: T; timestamp: number }> = [];
  private listeners = new Map<string, (...args: any[]) => void>();

  constructor(private emitter: any) {}

  /**
   * Start collecting events
   */
  collect(eventName: string): this {
    const listener = (...args: any[]) => {
      this.events.push({
        event: eventName,
        data: args.length === 1 ? args[0] : args,
        timestamp: Date.now()
      });
    };

    this.listeners.set(eventName, listener);
    this.emitter.on(eventName, listener);
    return this;
  }

  /**
   * Stop collecting events
   */
  stop(eventName?: string): void {
    if (eventName) {
      const listener = this.listeners.get(eventName);
      if (listener) {
        this.emitter.off(eventName, listener);
        this.listeners.delete(eventName);
      }
    } else {
      for (const [event, listener] of this.listeners) {
        this.emitter.off(event, listener);
      }
      this.listeners.clear();
    }
  }

  /**
   * Get collected events
   */
  getEvents(eventName?: string): Array<{ event: string; data: T; timestamp: number }> {
    if (eventName) {
      return this.events.filter(e => e.event === eventName);
    }
    return [...this.events];
  }

  /**
   * Clear collected events
   */
  clear(): void {
    this.events = [];
  }

  /**
   * Wait for an event
   */
  async waitForEvent(eventName: string, timeout = 5000): Promise<T> {
    const deferred = defer<T>();

    const listener = (data: T) => {
      deferred.resolve(data);
    };

    this.emitter.once(eventName, listener);

    const timer = setTimeout(() => {
      this.emitter.off(eventName, listener);
      deferred.reject(Errors.timeout('event: ' + eventName, timeout));
    }, timeout);

    try {
      const result = await deferred.promise;
      clearTimeout(timer);
      return result;
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }

  /**
   * Get event count
   */
  getEventCount(eventName?: string): number {
    if (eventName) {
      return this.events.filter(e => e.event === eventName).length;
    }
    return this.events.length;
  }

  /**
   * Assert event was emitted
   */
  assertEmitted(eventName: string, expectedCount?: number): void {
    const count = this.getEventCount(eventName);
    if (expectedCount !== undefined) {
      if (count !== expectedCount) {
        throw new Error(`Expected ${expectedCount} ${eventName} events, got ${count}`);
      }
    } else if (count === 0) {
      throw new Error(`Expected ${eventName} event to be emitted`);
    }
  }

  /**
   * Assert event was not emitted
   */
  assertNotEmitted(eventName: string): void {
    const count = this.getEventCount(eventName);
    if (count > 0) {
      throw new Error(`Expected ${eventName} event not to be emitted, but got ${count}`);
    }
  }
}

/**
 * Create an event collector
 */
export function collectEvents<T = any>(emitter: any): EventCollector<T> {
  return new EventCollector<T>(emitter);
}

/**
 * Memory leak detector
 */
export class MemoryLeakDetector {
  private initialMemory: number;
  private measurements: number[] = [];

  constructor() {
    if (global.gc) {
      global.gc();
    }
    this.initialMemory = process.memoryUsage().heapUsed;
  }

  /**
   * Measure current memory usage
   */
  measure(): number {
    if (global.gc) {
      global.gc();
    }
    const current = process.memoryUsage().heapUsed;
    const delta = current - this.initialMemory;
    this.measurements.push(delta);
    return delta;
  }

  /**
   * Check if there's a potential leak
   */
  hasLeak(threshold = 10 * 1024 * 1024): boolean {
    // Consider it a leak if memory grows by more than threshold
    if (this.measurements.length < 2) {
      return false;
    }

    const recent = this.measurements.slice(-5);
    const average = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    return average > threshold;
  }

  /**
   * Get memory growth trend
   */
  getTrend(): 'stable' | 'growing' | 'shrinking' {
    if (this.measurements.length < 3) {
      return 'stable';
    }

    const recent = this.measurements.slice(-5);
    let growing = 0;
    let shrinking = 0;

    for (let i = 1; i < recent.length; i++) {
      const current = recent[i];
      const previous = recent[i - 1];
      if (current !== undefined && previous !== undefined) {
        if (current > previous) {
          growing++;
        } else if (current < previous) {
          shrinking++;
        }
      }
    }

    if (growing > shrinking * 2) {
      return 'growing';
    } else if (shrinking > growing * 2) {
      return 'shrinking';
    }
    return 'stable';
  }

  /**
   * Reset measurements
   */
  reset(): void {
    if (global.gc) {
      global.gc();
    }
    this.initialMemory = process.memoryUsage().heapUsed;
    this.measurements = [];
  }
}

/**
 * Performance timer
 */
export class PerfTimer {
  private marks = new Map<string, number>();
  private measures = new Map<string, number[]>();

  /**
   * Mark a point in time
   */
  mark(name: string): void {
    this.marks.set(name, performance.now());
  }

  /**
   * Measure between two marks
   */
  measure(name: string, startMark: string, endMark?: string): number {
    const start = this.marks.get(startMark);
    if (!start) {
      throw Errors.notFound('performance mark', startMark);
    }

    const end = endMark ? this.marks.get(endMark) : performance.now();
    if (!end) {
      throw Errors.notFound('performance mark', endMark);
    }

    const duration = end - start;

    let measures = this.measures.get(name);
    if (!measures) {
      measures = [];
      this.measures.set(name, measures);
    }
    measures.push(duration);

    return duration;
  }

  /**
   * Get average duration for a measure
   */
  getAverage(name: string): number {
    const measures = this.measures.get(name);
    if (!measures || measures.length === 0) {
      return 0;
    }
    return measures.reduce((sum, val) => sum + val, 0) / measures.length;
  }

  /**
   * Get percentile for a measure
   */
  getPercentile(name: string, percentile: number): number {
    const measures = this.measures.get(name);
    if (!measures || measures.length === 0) {
      return 0;
    }

    const sorted = [...measures].sort((a, b) => a - b);
    const index = Math.min(Math.floor(sorted.length * (percentile / 100)), sorted.length - 1);
    return sorted[index] ?? 0;
  }

  /**
   * Clear all marks and measures
   */
  clear(): void {
    this.marks.clear();
    this.measures.clear();
  }
}

/**
 * Create a mock function with specific behavior
 */
export function createMockFn<T extends (...args: any[]) => any>(
  implementation?: T
): jest.Mock<ReturnType<T>, Parameters<T>> {
  return jest.fn(implementation) as any;
}

/**
 * Create a stub object with all methods mocked
 */
export function createStub<T>(obj: Partial<T> = {}): T {
  const stub = {} as any;

  for (const key in obj) {
    const value = obj[key];
    if (typeof value === 'function') {
      stub[key] = jest.fn(value as any);
    } else {
      stub[key] = value;
    }
  }

  return stub;
}

/**
 * Assert that a promise rejects with a specific error
 */
export async function assertRejects(
  promise: Promise<any>,
  expectedError?: string | RegExp | typeof Error
): Promise<void> {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (error: any) {
    if (expectedError) {
      if (typeof expectedError === 'string') {
        if (!error.message.includes(expectedError)) {
          throw new Error(`Expected error to include "${expectedError}", got: ${error.message}`);
        }
      } else if (expectedError instanceof RegExp) {
        if (!expectedError.test(error.message)) {
          throw new Error(`Expected error to match ${expectedError}, got: ${error.message}`);
        }
      } else if (typeof expectedError === 'function') {
        if (!(error instanceof expectedError)) {
          throw new Error(`Expected error to be instance of ${expectedError.name}`);
        }
      }
    }
  }
}

/**
 * Create a test fixture
 */
export interface TestFixture<T> {
  setup: () => T | Promise<T>;
  teardown?: (fixture: T) => void | Promise<void>;
}

export async function withFixture<T, R>(
  fixture: TestFixture<T>,
  fn: (fixture: T) => R | Promise<R>
): Promise<R> {
  const instance = await fixture.setup();
  try {
    return await fn(instance);
  } finally {
    if (fixture.teardown) {
      await fixture.teardown(instance);
    }
  }
}