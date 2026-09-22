/**
 * How many threads libuv gets in a child.
 *
 * The pool defaults to FOUR, on any machine, and it is where `bcrypt`,
 * `crypto.pbkdf2`, `fs` and DNS do their work. Nothing here set
 * `UV_THREADPOOL_SIZE`, so a sixteen-core box ran six concurrent sign-ins
 * four at a time. Measured by omni-be on a live application: `bcrypt`
 * accounted for 99% of a four-second sign-in, while three database round
 * trips together took 28 ms. Verified before changing anything — `ps eww` on
 * a live child showed no such variable, and `os.availableParallelism()`
 * reported 16.
 *
 * It must be set in the child's ENVIRONMENT rather than inside the
 * application. libuv fixes the pool the first time it is used, and under
 * `tsx` the loader reaches it first: 724 ms with an in-process assignment
 * against 203 ms with the environment variable, same work.
 *
 * Three conditions, each a way this could go wrong:
 *
 *   - an operator who states a value keeps it — they may know something about
 *     their machine that this does not;
 *   - a floor of libuv's own 4, because `availableParallelism()` can
 *     legitimately return 1 and a one-thread pool is worse than the default
 *     it replaces;
 *   - a ceiling, because a container with a CPU quota still reports the
 *     HOST's cores, and threads cost memory whether or not they ever run.
 */

export interface ThreadPoolOptions {
  /** `os.availableParallelism()`. Injected for tests. */
  parallelism: number;
  /** Floor — libuv's own default. */
  min?: number;
  /** Ceiling — past this, extra threads cost memory and buy nothing. */
  max?: number;
}

/** libuv's own default, and the floor below which this must never go. */
const LIBUV_DEFAULT = 4;

/**
 * Above this, a pool stops being about parallelism and starts being about
 * memory: each thread carries a stack, and a quota-limited container cannot
 * run them anyway.
 */
const POOL_CEILING = 16;

export function threadPoolSizeFor(
  env: NodeJS.ProcessEnv,
  options: ThreadPoolOptions,
): string {
  // An operator's own number wins — but only if it is one. An empty or
  // malformed setting is a typo, not a decision, and treating it as one
  // would pin every child to the default it is meant to replace.
  const stated = Number(env['UV_THREADPOOL_SIZE']);
  if (Number.isInteger(stated) && stated > 0) return String(stated);

  const min = options.min ?? LIBUV_DEFAULT;
  const max = options.max ?? POOL_CEILING;
  return String(Math.min(Math.max(options.parallelism, min), max));
}
