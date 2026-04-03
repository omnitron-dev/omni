/**
 * Titan Metrics — @Metrics() Method Decorator
 *
 * Auto-instruments Netron service methods with request counting,
 * duration tracking, and error recording.
 *
 * @module titan-metrics
 */

import type { MetricsService } from './metrics.service.js';

/**
 * Weak map from class instances to their MetricsService.
 * Set by the module bootstrap when it injects the service into decorated classes.
 */
const serviceMap = new WeakMap<object, MetricsService>();

/**
 * Attach a MetricsService to an instance for decorator use.
 * Called by the module during DI wiring.
 */
export function attachMetricsService(instance: object, service: MetricsService): void {
  serviceMap.set(instance, service);
}

/**
 * Method decorator that auto-instruments a Netron service method.
 *
 * Tracks:
 *  - `rpc_requests_total` counter (labels: method, status)
 *  - `rpc_request_duration_seconds` histogram (labels: method)
 *  - `rpc_errors_total` counter (labels: method, error)
 *
 * @param metricName - Optional override for the metric method label.
 *                     Defaults to `ClassName.methodName`.
 */
export function Metrics(metricName?: string) {
  return function <T extends (...args: never[]) => unknown>(
    _target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ): TypedPropertyDescriptor<T> {
    const original = descriptor.value;
    if (!original) return descriptor;

    const methodKey = String(propertyKey);

    descriptor.value = function (this: object, ...args: Parameters<T>): ReturnType<T> {
      const svc = serviceMap.get(this);
      const name = metricName ?? `${this.constructor.name}.${methodKey}`;
      const start = performance.now();

      let result: unknown;
      try {
        result = (original as Function).apply(this, args);
      } catch (err: unknown) {
        recordFinish(svc, name, start, 'error', err);
        throw err;
      }

      // Handle async (Promise) results
      if (result != null && typeof (result as PromiseLike<unknown>).then === 'function') {
        return (result as Promise<unknown>).then(
          (val: unknown) => {
            recordFinish(svc, name, start, 'success');
            return val;
          },
          (err: unknown) => {
            recordFinish(svc, name, start, 'error', err);
            throw err;
          },
        ) as ReturnType<T>;
      }

      // Sync result
      recordFinish(svc, name, start, 'success');
      return result as ReturnType<T>;
    } as T;

    // Preserve original name for reflection
    Object.defineProperty(descriptor.value, 'name', { value: methodKey });

    return descriptor;
  };
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function recordFinish(
  svc: MetricsService | undefined,
  method: string,
  startMs: number,
  status: 'success' | 'error',
  _err?: unknown,
): void {
  if (!svc) return;

  const registry = svc.getRegistry();
  const durationSec = (performance.now() - startMs) / 1_000;
  const labels = { method };

  registry.counter('rpc_requests_total', { ...labels, status }, 1);
  registry.histogram('rpc_request_duration_seconds', labels, durationSec);

  if (status === 'error') {
    const errorName = _err instanceof Error ? _err.constructor.name : 'UnknownError';
    registry.counter('rpc_errors_total', { ...labels, error: errorName }, 1);
  }
}
