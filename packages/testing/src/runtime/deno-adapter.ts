/**
 * Deno adapter for running tests
 * Provides compatibility layer for Vitest API
 */

// @ts-expect-error - Deno specific imports
import { FakeTime } from 'https://deno.land/std@0.208.0/testing/time.ts';
// @ts-expect-error - Deno specific imports
import { expect as denoExpect, addMatchers } from 'https://deno.land/x/expect@v0.3.0/mod.ts';
// @ts-expect-error - Deno specific imports
import { it as denoIt, describe as denoDescribe, beforeAll as denoBeforeAll, beforeEach as denoBeforeEach, afterAll as denoAfterAll, afterEach as denoAfterEach } from 'https://deno.land/std@0.208.0/testing/bdd.ts';

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
/**
 * Lifecycle hooks and blocks delegate to std's bdd, which already scopes hooks
 * to the enclosing `describe`.
 *
 * They used to be four module-level arrays that `it` drained by hand, so a
 * `beforeEach` registered inside one `describe` ran for EVERY test declared
 * afterwards — across files. Concretely: `packages/common`'s
 * `timed-map.spec.ts` installs fake timers in its `beforeEach`, and every
 * later test in the aggregated Deno run inherited them, so `await delay(1)` in
 * a different file never resolved. The run reported all 7 suites passed and
 * then exited 1 with "Promise resolution is still pending but the event loop
 * has already resolved" — an exit code with no failing test attached.
 *
 * `beforeAll` had a second bug in the same code: the callbacks were
 * snapshotted BEFORE the describe body ran, so hooks registered inside the
 * body never executed at all.
 */
const beforeEach = denoBeforeEach;
const afterEach = denoAfterEach;
const beforeAll = denoBeforeAll;
const afterAll = denoAfterAll;

function describe(name: string, fn: () => void) {
  denoDescribe(name, fn);
}

function it(name: string, fn: () => void | Promise<void>) {
  denoIt(name, fn);
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
  // These three used to be assigned onto the object `expect(...)` returns,
  // which this module ignores — `toStrictEqual` reached a spec as
  // "matcher not found". Same fix, same reason: `addMatchers` is the way in.
  toBeInstanceOf(value: any, constructor: any) {
    return value instanceof constructor
      ? { pass: true }
      : { pass: false, message: `expected ${Deno.inspect(value)} to be instance of ${constructor?.name}` };
  },
  toStrictEqual(value: any, expected: any) {
    return Deno.inspect(value) === Deno.inspect(expected)
      ? { pass: true }
      : { pass: false, message: `expected ${Deno.inspect(value)} to strictly equal ${Deno.inspect(expected)}` };
  },
  toThrowError(value: any, expected?: any) {
    let error: any;
    let thrown = false;
    try {
      if (typeof value === 'function') value();
    } catch (e) {
      error = e;
      thrown = true;
    }
    if (!thrown) return { pass: false, message: 'expected function to throw' };
    if (expected !== undefined) {
      if (typeof expected === 'string' && !String(error?.message).includes(expected)) {
        return { pass: false, message: `expected error message to include "${expected}"` };
      }
      if (expected instanceof RegExp && !expected.test(String(error?.message))) {
        return { pass: false, message: `expected error message to match ${expected}` };
      }
      if (typeof expected === 'function' && !(error instanceof expected)) {
        return { pass: false, message: `expected error to be instance of ${expected.name}` };
      }
    }
    return { pass: true };
  },
});

// Custom expect wrapper that adds missing methods
const expect = (value: any) => {
  const matcher = denoExpect(value);

  // Add missing matcher methods to the chain
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
