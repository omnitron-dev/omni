/**
 * Every child ran its blocking work on four threads, whatever the machine.
 *
 * libuv's thread pool defaults to 4, and that pool is where `bcrypt`,
 * `crypto.pbkdf2`, `fs` and DNS do their work. Nothing in this package set
 * `UV_THREADPOOL_SIZE`, so a sixteen-core machine ran six concurrent sign-ins
 * four at a time — measured by omni-be on a live application: `bcrypt`
 * accounted for 99% of a four-second sign-in while three database round trips
 * together took 28 ms.
 *
 * Verified here before changing anything: `ps eww` on a live child shows no
 * `UV_THREADPOOL_SIZE` at all, while `os.availableParallelism()` reports 16.
 *
 * It has to be set in the child's ENVIRONMENT, not inside the application.
 * libuv reads the variable when the pool is first used, and under `tsx` the
 * loader gets there first — omni-be measured 724 ms with an in-process
 * assignment against 203 ms with the environment variable. By then the pool
 * exists and the number is fixed.
 *
 * Three conditions, and each is a way this could go wrong:
 *
 *   - an operator who states a value keeps it, because they may know
 *     something about their machine that this does not;
 *   - a floor of 4, because `availableParallelism()` can legitimately return
 *     1 and a single-threaded pool is worse than the default it replaces;
 *   - a ceiling, because inside a container with a CPU quota the host's core
 *     count is what gets reported, and sizing a pool to cores the process
 *     cannot use buys nothing and costs memory per thread.
 */

import { describe, it, expect } from 'vitest';

import { threadPoolSizeFor } from '../src/thread-pool.js';

describe('four threads for sixteen cores', () => {
  it('sizes the pool to the machine when nobody stated a value', () => {
    expect(threadPoolSizeFor({}, { parallelism: 16 })).toBe('16');
  });

  it("keeps an operator's own value", () => {
    // They may know something we do not — a pinned container, a shared box.
    expect(threadPoolSizeFor({ UV_THREADPOOL_SIZE: '8' }, { parallelism: 16 })).toBe('8');
    expect(threadPoolSizeFor({ UV_THREADPOOL_SIZE: '1' }, { parallelism: 16 })).toBe('1');
  });

  it('never goes below libuv\'s own default', () => {
    // `availableParallelism()` returns 1 on a constrained machine, and a
    // one-thread pool would be a regression against doing nothing at all.
    expect(threadPoolSizeFor({}, { parallelism: 1 })).toBe('4');
    expect(threadPoolSizeFor({}, { parallelism: 2 })).toBe('4');
  });

  it('does not size a pool to cores the process cannot use', () => {
    // In a container with a CPU quota, the HOST's core count is reported.
    // Threads cost memory whether or not they ever run.
    expect(threadPoolSizeFor({}, { parallelism: 128 })).toBe('16');
  });

  it('ignores a value that is not a usable number', () => {
    // Control: an empty or malformed setting must not be mistaken for an
    // operator's decision, or a typo would pin every child to the default.
    expect(threadPoolSizeFor({ UV_THREADPOOL_SIZE: '' }, { parallelism: 16 })).toBe('16');
    expect(threadPoolSizeFor({ UV_THREADPOOL_SIZE: 'lots' }, { parallelism: 16 })).toBe('16');
    expect(threadPoolSizeFor({ UV_THREADPOOL_SIZE: '0' }, { parallelism: 16 })).toBe('16');
  });
});
