/**
 * T#73 — AsyncLocalStorage-backed tracing propagation.
 *
 * `tracer` is the runtime side of `TraceContext`: it carries the
 * current trace across `await` boundaries via `AsyncLocalStorage`,
 * generates new trace/span ids, and round-trips contexts through the
 * W3C `traceparent` wire format.
 *
 * Why a thin module instead of pulling in `@opentelemetry/*`? The OTel
 * SDK is ~600 KB of optional infrastructure (samplers, exporters,
 * resource detectors) — adopting it lock-stock turns every consumer
 * into an OTel host. The audit's T#73 goal is propagation correctness,
 * not vendor commitment. By keeping the surface to <100 LoC we can
 * later swap the implementation to delegate to OTel without touching
 * call sites — only `tracer.ts` changes.
 *
 * Layered onto the eventual integration points:
 *   - Netron: serializer emits/consumes `traceparent` in packet headers
 *   - Logger: `bindings()` adds `traceId`/`spanId` automatically
 *   - Metrics: exemplars (low-cardinality `trace_id` label)
 *
 * Each of those is a separate, additive commit on top of this base.
 *
 * @stable
 * @since 0.1.4
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

import {
  INVALID_SPAN_ID,
  INVALID_TRACE_ID,
  TRACE_FLAGS,
  type TraceContext,
} from './context.js';

/**
 * Module-private storage. Exporting the ALS instance would let any
 * caller call `.enterWith()` and stomp on parent frames — keep it
 * private and expose only the lifecycle-safe helpers below.
 */
const storage = new AsyncLocalStorage<TraceContext>();

/**
 * Generate a fresh W3C-compatible trace id (16 bytes / 32 hex chars).
 *
 * The spec forbids the all-zeroes value. The probability of `randomBytes`
 * returning it is ~2^-128, but we re-roll defensively rather than rely
 * on that bound — keeps tests deterministic if anyone mocks `randomBytes`.
 */
export function createTraceId(): string {
  // Loop is here for completeness; in practice it never iterates.
  for (let i = 0; i < 4; i++) {
    const hex = randomBytes(16).toString('hex');
    if (hex !== INVALID_TRACE_ID) return hex;
  }
  // Statistically unreachable; throw rather than return invalid id.
  throw new Error('createTraceId: failed to generate non-zero trace id');
}

/**
 * Generate a fresh W3C-compatible span id (8 bytes / 16 hex chars).
 */
export function createSpanId(): string {
  for (let i = 0; i < 4; i++) {
    const hex = randomBytes(8).toString('hex');
    if (hex !== INVALID_SPAN_ID) return hex;
  }
  throw new Error('createSpanId: failed to generate non-zero span id');
}

/**
 * Return the trace context attached to the current async frame, or
 * `undefined` if none is set. Cheap — does not allocate.
 */
export function currentTrace(): TraceContext | undefined {
  return storage.getStore();
}

/**
 * Run `fn` with `ctx` installed as the current trace. Any code
 * `fn` invokes — sync or async — sees `ctx` via `currentTrace()`
 * until it returns, after which the previous trace (or undefined)
 * is restored.
 *
 * This is the ONLY way to install a context. Direct `.enterWith()`
 * is intentionally not exposed because it leaks across the rest of
 * the current async frame, which is almost never the intent.
 */
export function withTrace<T>(ctx: TraceContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Start a new span. If `parent` is omitted, defaults to the current
 * trace; if there is no current trace either, a new root span is
 * created.
 *
 * Returns the new context but does NOT install it as current —
 * callers wrap the work in `withTrace(span, () => …)` so the lifetime
 * is explicit. This avoids the classic OTel footgun where a span leaks
 * beyond its intended scope because someone forgot to `end()` it.
 */
export function startSpan(parent?: TraceContext): TraceContext {
  const inherited = parent ?? currentTrace();
  if (inherited) {
    return {
      traceId: inherited.traceId,
      spanId: createSpanId(),
      parentSpanId: inherited.spanId,
      flags: inherited.flags,
    };
  }
  return {
    traceId: createTraceId(),
    spanId: createSpanId(),
    parentSpanId: undefined,
    flags: TRACE_FLAGS.SAMPLED,
  };
}

// ─── W3C traceparent serialisation ────────────────────────────────────

/**
 * Render a `TraceContext` as a W3C `traceparent` header value.
 *
 *   `00-{traceId}-{spanId}-{flags}`
 *
 * Version is hardcoded to "00" — the only version defined as of the
 * 2020 W3C recommendation. Higher versions are reserved for future
 * extensibility; downstream parsers MUST treat unknown versions as
 * forward-compatible, so emitting "00" is the safe choice.
 */
export function formatTraceparent(ctx: TraceContext): string {
  const flagsHex = (ctx.flags & 0xff).toString(16).padStart(2, '0');
  return `00-${ctx.traceId}-${ctx.spanId}-${flagsHex}`;
}

/**
 * Parse a W3C `traceparent` header into a `TraceContext`. Returns
 * `undefined` for any malformed input (wrong shape, wrong length,
 * non-hex, or sentinel all-zero ids) rather than throwing — callers
 * shouldn't have to wrap every header read in try/catch.
 *
 * On parse, the inbound `spanId` becomes the `parentSpanId` of the
 * returned context: the caller's span is OUR parent. The returned
 * `spanId` is freshly generated so we don't collide with the caller's
 * own children. This is the W3C "context restoration" pattern.
 */
export function parseTraceparent(header: string | undefined | null): TraceContext | undefined {
  if (!header) return undefined;
  const parts = header.split('-');
  if (parts.length !== 4) return undefined;

  const [version, traceId, parentId, flagsHex] = parts as [string, string, string, string];

  if (version.length !== 2 || !/^[0-9a-f]{2}$/.test(version)) return undefined;
  if (version === 'ff') return undefined; // forbidden per W3C spec
  if (traceId.length !== 32 || !/^[0-9a-f]{32}$/.test(traceId) || traceId === INVALID_TRACE_ID) return undefined;
  if (parentId.length !== 16 || !/^[0-9a-f]{16}$/.test(parentId) || parentId === INVALID_SPAN_ID) return undefined;
  if (flagsHex.length !== 2 || !/^[0-9a-f]{2}$/.test(flagsHex)) return undefined;

  return {
    traceId,
    spanId: createSpanId(),
    parentSpanId: parentId,
    flags: Number.parseInt(flagsHex, 16),
  };
}

/**
 * Convenience: read `traceparent` from a headers-like object (case-
 * insensitive) and parse. Returns undefined if absent or malformed.
 *
 * Accepts either `Record<string, string | string[] | undefined>` (Node
 * http) or a Fetch `Headers` instance.
 */
export function extractTraceparent(
  headers:
    | Headers
    | Record<string, string | string[] | undefined>
    | undefined
    | null,
): TraceContext | undefined {
  if (!headers) return undefined;
  let raw: string | string[] | null | undefined;
  if (typeof (headers as Headers).get === 'function') {
    raw = (headers as Headers).get('traceparent');
  } else {
    const rec = headers as Record<string, string | string[] | undefined>;
    raw = rec['traceparent'] ?? rec['Traceparent'] ?? rec['TRACEPARENT'];
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseTraceparent(value ?? undefined);
}
