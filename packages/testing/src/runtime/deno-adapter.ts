/**
 * Deno adapter for running Jest tests
 * Provides compatibility layer for Jest API
 */

// @ts-expect-error - Deno specific imports
import { FakeTime } from 'https://deno.land/std@0.208.0/testing/time.ts';
// @ts-expect-error - Deno specific imports
import { expect as denoExpect } from 'https://deno.land/x/expect@v0.3.0/mod.ts';
// @ts-expect-error - Deno specific imports
import { it as denoIt, describe as denoDescribe } from 'https://deno.land/std@0.208.0/testing/bdd.ts';

// Polyfill for node:util inherits
function inherits(ctor: any, superCtor: any) {
  if (ctor === undefined || ctor === null) {
    throw new TypeError('The constructor to "inherits" must not be null or undefined');
  }
  if (superCtor === undefined || superCtor === null) {
    throw new TypeError('The super constructor to "inherits" must not be null or undefined');
  }
  if (superCtor.prototype === undefined) {
    throw new TypeError('The super constructor to "inherits" must have a prototype property');
  }
  ctor.super_ = superCtor;
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

// Store global state
let fakeTime: FakeTime | null = null;
const beforeEachCallbacks: Array<() => void | Promise<void>> = [];
const afterEachCallbacks: Array<() => void | Promise<void>> = [];
const beforeAllCallbacks: Array<() => void | Promise<void>> = [];
const afterAllCallbacks: Array<() => void | Promise<void>> = [];

// Custom describe that handles lifecycle hooks
function describe(name: string, fn: () => void) {
  denoDescribe(name, () => {
    // Clear callbacks for this describe block
    // Note: These are preserved for potential future use in nested describe blocks
    // const localBeforeEach = [...beforeEachCallbacks];
    // const localAfterEach = [...afterEachCallbacks];
    const localBeforeAll = [...beforeAllCallbacks];
    const localAfterAll = [...afterAllCallbacks];

    // Run beforeAll hooks
    if (localBeforeAll.length > 0) {
      denoIt('beforeAll', async () => {
        for (const cb of localBeforeAll) {
          await cb();
        }
      });
    }

    fn();

    // Run afterAll hooks
    if (localAfterAll.length > 0) {
      denoIt('afterAll', async () => {
        for (const cb of localAfterAll) {
          await cb();
        }
      });
    }
  });
}

// Custom it/test that runs lifecycle hooks
function it(name: string, fn: () => void | Promise<void>) {
  denoIt(name, async () => {
    // Run beforeEach hooks
    for (const cb of beforeEachCallbacks) {
      await cb();
    }

    try {
      await fn();
    } finally {
      // Run afterEach hooks
      for (const cb of afterEachCallbacks) {
        await cb();
      }
    }
  });
}

// Lifecycle hooks
function beforeEach(fn: () => void | Promise<void>) {
  beforeEachCallbacks.push(fn);
}

function afterEach(fn: () => void | Promise<void>) {
  afterEachCallbacks.push(fn);
}

function beforeAll(fn: () => void | Promise<void>) {
  beforeAllCallbacks.push(fn);
}

function afterAll(fn: () => void | Promise<void>) {
  afterAllCallbacks.push(fn);
}

// Mock function implementation
function mockFn(implementation?: (...args: any[]) => any) {
  const calls: any[][] = [];
  const results: any[] = [];

  const fn = (...args: any[]) => {
    calls.push(args);
    const result = implementation ? implementation(...args) : undefined;
    results.push(result);
    return result;
  };

  fn.mock = {
    calls,
    results,
    lastCall: () => calls[calls.length - 1],
  };

  fn.mockImplementation = (impl: (...args: any[]) => any) => {
    implementation = impl;
    return fn;
  };

  fn.mockReturnValue = (value: any) => {
    implementation = () => value;
    return fn;
  };

  fn.mockResolvedValue = (value: any) => {
    implementation = () => Promise.resolve(value);
    return fn;
  };

  fn.mockRejectedValue = (value: any) => {
    implementation = () => Promise.reject(value);
    return fn;
  };

  fn.mockClear = () => {
    calls.length = 0;
    results.length = 0;
  };

  fn.mockReset = () => {
    calls.length = 0;
    results.length = 0;
    implementation = undefined;
  };

  return fn;
}

// Mock timer functions
const fakeTimers = {
  useFakeTimers: () => {
    fakeTime = new FakeTime();
    return fakeTimers;
  },
  useRealTimers: () => {
    if (fakeTime) {
      fakeTime.restore();
      fakeTime = null;
    }
    return fakeTimers;
  },
  advanceTimersByTime: (ms: number) => {
    if (fakeTime) {
      fakeTime.tick(ms);
    }
  },
  runAllTimers: () => {
    if (fakeTime) {
      fakeTime.runAll();
    }
  },
  clearAllTimers: () => {
    if (fakeTime) {
      fakeTime.restore();
      fakeTime = new FakeTime();
    }
  },
};

// Custom expect wrapper that adds missing methods
const expect = (value: any) => {
  const matcher = denoExpect(value);

  // Add missing matcher methods to the chain
  matcher.toBeInstanceOf = function toBeInstanceOf(constructor: any) {
    const pass = value instanceof constructor;
    if (!pass) {
      throw new Error(`expected ${value} to be instance of ${constructor.name}`);
    }
    return { pass };
  };

  matcher.toStrictEqual = function toStrictEqual(expected: any) {
    return matcher.toEqual(expected);
  };

  matcher.toThrowError = function toThrowError(expected?: any) {
    let error: any;
    let thrown = false;

    try {
      if (typeof value === 'function') {
        value();
      }
    } catch (e) {
      error = e;
      thrown = true;
    }

    if (!thrown) {
      throw new Error('expected function to throw');
    }

    if (expected !== undefined) {
      if (typeof expected === 'string' && !error.message.includes(expected)) {
        throw new Error(`expected error message to include "${expected}"`);
      }
      if (expected instanceof RegExp && !expected.test(error.message)) {
        throw new Error(`expected error message to match ${expected}`);
      }
      if (typeof expected === 'function' && !(error instanceof expected)) {
        throw new Error(`expected error to be instance of ${expected.name}`);
      }
    }

    return { pass: true };
  };

  return matcher;
};

// Add static methods
expect.extend = (matchers: Record<string, any>) => {
  Object.assign(expect, matchers);
};

// Make APIs globally available
(globalThis as any).describe = describe;
(globalThis as any).test = it;
(globalThis as any).it = it;
(globalThis as any).expect = expect;
(globalThis as any).beforeEach = beforeEach;
(globalThis as any).afterEach = afterEach;
(globalThis as any).beforeAll = beforeAll;
(globalThis as any).afterAll = afterAll;

// Mock Jest APIs
(globalThis as any).jest = {
  fn: mockFn,
  mock: mockFn,
  useFakeTimers: fakeTimers.useFakeTimers,
  useRealTimers: fakeTimers.useRealTimers,
  advanceTimersByTime: fakeTimers.advanceTimersByTime,
  runAllTimers: fakeTimers.runAllTimers,
  clearAllTimers: fakeTimers.clearAllTimers,
};

// Make Node.js APIs available globally for tests
(globalThis as any).node = {
  util: {
    inherits,
  },
};

// Export everything
export { it, expect, mockFn, describe, afterAll, inherits, afterEach, beforeAll, beforeEach };
