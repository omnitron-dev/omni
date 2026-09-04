/**
 * A stable reference to a connection whose underlying object is replaced.
 *
 * `DATABASE_CONNECTION` and every repository built by `forFeature` are
 * Singletons: they resolve the connection once and hold the value they were
 * given for the life of the process. Reconnection replaces that value —
 * `reconnect()` calls `close()`, which runs `instance.destroy()`, and then
 * constructs a new `Kysely` and a new executor. Nothing propagated the swap,
 * so after the first reconnect every consumer held a destroyed instance and
 * every query failed with `driver has already been destroyed`, permanently,
 * until the process restarted.
 *
 * A live reference closes that gap without changing anyone's contract:
 * consumers keep a plain `Kysely<DB>`-shaped object, and each property access
 * is resolved against the connection that is current at that moment.
 */

/** Resolves the object a live reference should currently delegate to. */
export type ConnectionResolver<T extends object> = () => T;

/**
 * Reads that must never throw, because the runtime performs them on objects it
 * knows nothing about. `then` is the load-bearing one: an async provider
 * factory returning this reference makes the runtime probe `.then` to decide
 * whether it is a thenable, and a resolver that threw there would turn an
 * unavailable database into an unhandled rejection at wiring time rather than
 * a clear error at query time.
 */
const SAFE_PROBES: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  'then',
  'catch',
  'finally',
  'toJSON',
  'inspect',
  Symbol.toStringTag,
  Symbol.toPrimitive,
  Symbol.iterator,
  Symbol.asyncIterator,
  Symbol.for('nodejs.util.inspect.custom'),
]);

/**
 * Wraps a resolver in an object that delegates every operation to whatever the
 * resolver currently returns.
 *
 * Methods are bound to the resolved object rather than to the proxy: Kysely and
 * the Kysera executor both use private class fields, and a method invoked with
 * the proxy as `this` cannot read them.
 */
export function createLiveConnectionRef<T extends object>(resolve: ConnectionResolver<T>): T {
  // Bound methods are memoised per resolved object so repeated reads of the
  // same method return the same function, and so the cache is dropped with the
  // instance it belongs to.
  const boundMethods = new WeakMap<object, Map<PropertyKey, unknown>>();

  const resolveSafely = (): T | undefined => {
    try {
      return resolve();
    } catch {
      return undefined;
    }
  };

  return new Proxy({} as T, {
    get(_target, property) {
      const current = SAFE_PROBES.has(property) ? resolveSafely() : resolve();
      if (current === undefined) return undefined;

      const value = Reflect.get(current, property, current);
      if (typeof value !== 'function') return value;

      let methods = boundMethods.get(current);
      if (!methods) {
        methods = new Map();
        boundMethods.set(current, methods);
      }
      const cached = methods.get(property);
      if (cached) return cached;

      const bound = (value as (...args: unknown[]) => unknown).bind(current);
      methods.set(property, bound);
      return bound;
    },

    set(_target, property, value) {
      return Reflect.set(resolve(), property, value);
    },

    has(_target, property) {
      const current = resolveSafely();
      return current === undefined ? false : Reflect.has(current, property);
    },

    deleteProperty(_target, property) {
      return Reflect.deleteProperty(resolve(), property);
    },

    ownKeys() {
      const current = resolveSafely();
      return current === undefined ? [] : Reflect.ownKeys(current);
    },

    getOwnPropertyDescriptor(_target, property) {
      const current = resolveSafely();
      if (current === undefined) return undefined;
      const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
      // The proxy target is an empty object that owns none of these keys, so
      // every descriptor reported has to be configurable or the invariant
      // check throws.
      return descriptor && { ...descriptor, configurable: true };
    },

    getPrototypeOf() {
      const current = resolveSafely();
      return current === undefined ? null : Reflect.getPrototypeOf(current);
    },
  });
}
