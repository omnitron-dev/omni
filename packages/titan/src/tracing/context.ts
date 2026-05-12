/**
 * T#73 — Distributed tracing context type (W3C Trace Context aligned).
 *
 * `TraceContext` is the minimum shape needed to correlate work across
 * processes / RPC hops. It mirrors the identifier portion of the W3C
 * Trace Context `traceparent` header (RFC w3c trace-context), so callers
 * can encode/decode without a translation layer:
 *
 *   traceparent = version "-" trace-id "-" parent-id "-" trace-flags
 *
 *  - `traceId`  is a 32-character lowercase hex string (16 bytes).
 *  - `spanId`   is a 16-character lowercase hex string (8 bytes).
 *  - `parentSpanId` is the immediate-parent span id, or `undefined`
 *                   when this is a root span.
 *  - `flags`    are the W3C trace-flags byte (currently only bit 0 —
 *               `sampled` — is defined). Default 0x01 ("sampled").
 *
 * This module deliberately ships ONLY the propagation primitive — no
 * span lifecycle, no exporters, no sampling decisions beyond the
 * sampled flag. Downstream integrations (Netron, logger, metrics)
 * extend this with their own semantics. Keeping the foundation tiny
 * means the type can be adopted incrementally without locking the
 * project into a specific tracing backend (OTel, Jaeger, Zipkin, …).
 *
 * @stable
 * @since 0.1.4
 */

/**
 * Forbidden trace-id value per W3C spec: all zeroes means "no trace".
 */
export const INVALID_TRACE_ID = '00000000000000000000000000000000';

/**
 * Forbidden span-id value per W3C spec: all zeroes means "no span".
 */
export const INVALID_SPAN_ID = '0000000000000000';

/**
 * W3C trace-flags byte. Only bit 0 (sampled) is currently defined.
 */
export const TRACE_FLAGS = {
  NONE: 0x00,
  SAMPLED: 0x01,
} as const;

/**
 * A snapshot of distributed-tracing identifiers for a unit of work.
 *
 * `TraceContext` is intentionally immutable — child spans are produced
 * by `startSpan()` rather than by mutating the parent's fields. This
 * makes the type safe to pass across `await` boundaries and to attach
 * to log records without worrying about retroactive edits.
 */
export interface TraceContext {
  /** 32-char lowercase hex; same across every span in a single trace. */
  readonly traceId: string;
  /** 16-char lowercase hex; unique per span. */
  readonly spanId: string;
  /** Immediate-parent span id, or undefined for a root span. */
  readonly parentSpanId?: string;
  /** W3C trace-flags byte. Bit 0 (sampled) is the only defined bit. */
  readonly flags: number;
}

/**
 * Build a `TraceContext` literal with sensible defaults applied. Used
 * primarily by tests; production code should prefer `startSpan()` or
 * `parseTraceparent()` so identifier generation lives in one place.
 *
 * @internal
 */
export function makeTraceContext(partial: Partial<TraceContext> & Pick<TraceContext, 'traceId' | 'spanId'>): TraceContext {
  return {
    traceId: partial.traceId,
    spanId: partial.spanId,
    parentSpanId: partial.parentSpanId,
    flags: partial.flags ?? TRACE_FLAGS.SAMPLED,
  };
}
