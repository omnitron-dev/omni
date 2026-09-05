/**
 * Deno adapter for running tests
 * Provides compatibility layer for Vitest API
 */

// @ts-expect-error - Deno specific imports
import { FakeTime } from 'https://deno.land/std@0.208.0/testing/time.ts';
// @ts-expect-error - Deno specific imports
import { expect as denoExpect, addMatchers } from 'https://deno.land/x/expect@v0.3.0/mod.ts';
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

  // `function`, not an arrow, and `.apply` rather than a spread call: a mock
  // must forward `this`. An arrow has no own `this` to forward, so
  // `map.forEach(mock, context)` — or any callback whose contract includes a
  // receiver — silently ran with the wrong one, and the assertion inside the
  // callback failed in a way that pointed at the code under test.
  const fn = function (this: any, ...args: any[]) {
    calls.push(args);
    const result = implementation ? implementation.apply(this, args) : undefined;
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

  fn.mockRestore = () => {
    fn.mockReset();
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

/**
 * Vitest-shaped mocking surface for Deno.
 *
 * `vi` is what specs written against vitest actually import, and its absence
 * here was the last thing keeping a cross-runtime run from working at all: a
 * spec doing `import { vi } from 'vitest'` fails to LOAD under Deno, taking the
 * whole file with it before a single test runs. Built from the pieces this
 * adapter already had — `mockFn` and `fakeTimers` — so it covers what specs in
 * this monorepo use (`fn`, `spyOn`, and the four timer controls) rather than
 * pretending to be all of vitest.
 */
const vi = {
  fn: mockFn,
  mock: mockFn,
  spyOn: (obj: any, method: string) => {
    const original = obj[method];
    const spy = mockFn(original);
    obj[method] = spy;
    (spy as any).mockRestore = () => {
      obj[method] = original;
    };
    return spy;
  },
  isMockFunction: (fn: any) => typeof fn === 'function' && typeof (fn as any).mock !== 'undefined',
  useFakeTimers: fakeTimers.useFakeTimers,
  useRealTimers: fakeTimers.useRealTimers,
  advanceTimersByTime: fakeTimers.advanceTimersByTime,
  runAllTimers: fakeTimers.runAllTimers,
  clearAllTimers: fakeTimers.clearAllTimers,
};

/**
 * Call matchers for OUR mocks.
 *
 * `deno.land/x/expect` implements `toHaveBeenCalled*` only for functions made
 * by its own `mock.fn`, and throws "callCount only available on mock
 * functions" for anything else — so a vitest-shaped spec asserting on a
 * callback failed on the matcher rather than on the behaviour. Its `mock.fn`
 * is not a substitute: it drops `this`, which is the bug fixed in `mockFn`
 * below.
 *
 * `addMatchers` is the module's supported extension point and overrides the
 * built-ins. Assigning onto the object returned by `expect(...)` does not:
 * tried first, and the built-in kept winning.
 */
const callsOf = (v: any): any[][] => (v && v.mock && Array.isArray(v.mock.calls) ? v.mock.calls : []);
const sameArgs = (a: any[], b: any[]) =>
  a.length === b.length && a.every((x, i) => Deno.inspect(x) === Deno.inspect(b[i]));

addMatchers({
  toHaveBeenCalled(value: any) {
    const n = callsOf(value).length;
    return n > 0 ? { pass: true } : { pass: false, message: 'expected mock to have been called' };
  },
  toHaveBeenCalledTimes(value: any, times: number) {
    const n = callsOf(value).length;
    return n === times
      ? { pass: true }
      : { pass: false, message: `expected ${times} call(s), got ${n}` };
  },
  toHaveBeenCalledWith(value: any, ...expected: any[]) {
    const calls = callsOf(value);
    return calls.some((c) => sameArgs(c, expected))
      ? { pass: true }
      : { pass: false, message: `expected a call with ${Deno.inspect(expected)}; calls: ${Deno.inspect(calls)}` };
  },
  toHaveBeenLastCalledWith(value: any, ...expected: any[]) {
    const calls = callsOf(value);
    const last = calls[calls.length - 1];
    return last && sameArgs(last, expected)
      ? { pass: true }
      : { pass: false, message: `last call was ${Deno.inspect(last)}, expected ${Deno.inspect(expected)}` };
  },
});

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

// Mock vi APIs (Vitest-compatible)
(globalThis as any).vi = {
  fn: mockFn,
  mock: mockFn,
  spyOn: (obj: any, method: string) => {
    const original = obj[method];
    const spy = mockFn(original);
    obj[method] = spy;
    spy.mockRestore = () => {
      obj[method] = original;
    };
    return spy;
  },
  isMockFunction: (fn: any) => typeof fn === 'function' && fn.mock !== undefined,
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
// `test` is an alias of `it`, and `fakeTimers` is part of the surface on the
// other runtimes — see the note in bun-adapter.ts. Absent names come back as
// `undefined` from `loadRuntimeAdapter()`, never as an import error.
export {
  it,
  it as test,
  expect,
  mockFn,
  describe,
  afterAll,
  inherits,
  afterEach,
  beforeAll,
  beforeEach,
  fakeTimers,
  vi,
};
