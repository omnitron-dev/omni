/**
 * Error description utilities.
 *
 * The motivating failure: on Node 22+ a `pg.Pool` (or any `net.connect`-based
 * client) that cannot reach its host rejects with a native `AggregateError`
 * whose own `message` is the EMPTY STRING — every underlying `ECONNREFUSED`
 * lives in `err.errors[]`. Code that logs `(err as Error).message` therefore
 * writes `{"error":"","msg":"Alert evaluation failed"}` and the diagnosis is
 * gone.
 *
 * `describeError()` is the single normalisation point: it always returns a
 * non-empty, human-readable string, unwrapping aggregate members and `cause`
 * chains, and it never throws — a logging helper that can throw is worse than
 * no helper at all.
 */

/** Options for {@link describeError}. */
export interface DescribeErrorOptions {
  /**
   * How deep to follow `cause` / aggregate nesting before emitting an ellipsis.
   * @default 5
   */
  maxDepth?: number;
  /**
   * How many members of an `AggregateError` to render before summarising the
   * remainder as `(+N more)`. Keeps a fan-out failure from flooding the log.
   * @default 10
   */
  maxErrors?: number;
}

const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_ERRORS = 10;

/**
 * Read a property without letting an exotic object (getter, Proxy, revoked
 * reference) throw out of a logging path.
 */
function safeGet(target: object, key: string): unknown {
  try {
    return (target as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Duck-typed error check. `instanceof Error` misses cross-realm errors — the
 * ones that arrive from worker threads, `vm` contexts and structured-clone
 * boundaries, all of which Titan uses.
 */
function isErrorLike(value: unknown): value is Error {
  if (value instanceof Error) return true;
  if (typeof value !== 'object' || value === null) return false;
  return typeof safeGet(value, 'name') === 'string' && typeof safeGet(value, 'message') === 'string';
}

/** Render a non-Error thrown value (strings, numbers, plain objects, null). */
function describeNonError(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value);
      // `undefined`, a function or a symbol serialises to `undefined`.
      if (json !== undefined && json !== '{}') return json;
    } catch {
      // Circular or throwing toJSON — fall through to String().
    }
  }

  let text: string;
  try {
    text = String(value);
  } catch {
    return '[unserializable value]';
  }

  if (text.trim() === '') return '<empty string>';
  // `String({})` and friends carry no information; name the type instead.
  if (text === '[object Object]') return `[object ${typeof value}]`;
  return text;
}

/**
 * The `code` property Node attaches to system errors (`ECONNREFUSED`,
 * `ENOTFOUND`, …). Returned only when it adds information the message lacks.
 */
function describeCode(error: Error, base: string): string {
  const code = safeGet(error, 'code');
  if (typeof code !== 'string' && typeof code !== 'number') return '';
  const text = String(code);
  if (text === '' || base.includes(text)) return '';
  return ` (${text})`;
}

/** The aggregate members of a native `AggregateError`, or null if not one. */
function aggregateMembers(error: Error): unknown[] | null {
  const errors = safeGet(error, 'errors');
  if (Array.isArray(errors)) return errors;
  // Cross-realm AggregateError may expose `errors` as an arbitrary iterable.
  if (errors != null && typeof (errors as Iterable<unknown>)[Symbol.iterator] === 'function') {
    try {
      return Array.from(errors as Iterable<unknown>);
    } catch {
      return null;
    }
  }
  return null;
}

function describeAt(value: unknown, depth: number, seen: Set<unknown>, opts: Required<DescribeErrorOptions>): string {
  if (!isErrorLike(value)) return describeNonError(value);

  // Cycles are reachable through `cause` and through aggregate members.
  if (seen.has(value)) return '[circular]';
  if (depth > opts.maxDepth) return '…';
  seen.add(value);

  const name = typeof value.name === 'string' && value.name !== '' ? value.name : 'Error';
  const rawMessage = safeGet(value, 'message');
  const message = typeof rawMessage === 'string' ? rawMessage.trim() : '';

  // An empty `message` is exactly the AggregateError case — fall back to the
  // constructor name so the line is never blank.
  let out = message !== '' ? message : name;
  out += describeCode(value, out);

  const members = aggregateMembers(value);
  if (members !== null && members.length > 0) {
    const shown = members.slice(0, opts.maxErrors).map((member) => describeAt(member, depth + 1, seen, opts));
    const hidden = members.length - shown.length;
    if (hidden > 0) shown.push(`(+${hidden} more)`);
    out += `: [${shown.join('; ')}]`;
  }

  const cause = safeGet(value, 'cause');
  if (cause !== undefined) {
    out += ` <- caused by: ${describeAt(cause, depth + 1, seen, opts)}`;
  }

  return out;
}

/**
 * Turn any thrown value into a non-empty, single-line diagnostic string.
 *
 * Unwraps native `AggregateError` members and `cause` chains, appends Node's
 * `code` when the message does not already carry it, tolerates non-Error
 * throws, and guards against cycles and unbounded nesting. Never throws.
 *
 * @example
 * ```typescript
 * // pg.Pool against an unreachable host on Node 22+
 * describeError(err);
 * // 'AggregateError: [connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED); ...]'
 *
 * describeError(new Error('write failed', { cause: new Error('disk full') }));
 * // 'write failed <- caused by: disk full'
 *
 * describeError('boom');   // 'boom'
 * describeError(null);     // 'null'
 * ```
 */
export function describeError(error: unknown, options: DescribeErrorOptions = {}): string {
  const opts: Required<DescribeErrorOptions> = {
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxErrors: options.maxErrors ?? DEFAULT_MAX_ERRORS,
  };

  try {
    return describeAt(error, 0, new Set(), opts);
  } catch {
    // describeAt is defensive throughout; this is the last line of defence so
    // that a logging call can never take down its caller.
    return '[undescribable error]';
  }
}
