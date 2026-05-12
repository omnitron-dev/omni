/**
 * T#73 — Distributed tracing foundation.
 *
 * Public entry point. Consumers import from `@omnitron-dev/titan/tracing`
 * to avoid pulling unrelated framework surface into call sites that
 * only need propagation primitives.
 *
 * @stable
 * @since 0.1.4
 */

export {
  INVALID_SPAN_ID,
  INVALID_TRACE_ID,
  TRACE_FLAGS,
  makeTraceContext,
  type TraceContext,
} from './context.js';

export {
  createSpanId,
  createTraceId,
  currentTrace,
  extractTraceparent,
  formatTraceparent,
  parseTraceparent,
  startSpan,
  withTrace,
} from './tracer.js';
