/**
 * T#73 — Foundation regression test for the tracing primitives.
 *
 * The audit's T#73 entry calls out that the platform had NO way to
 * correlate work across RPC hops: a request that fans out main → storage
 * → daos produced three independent log streams, and reconstructing the
 * causal chain required eyeballing timestamps. The fix introduces a
 * minimal `TraceContext` (W3C-aligned) with `AsyncLocalStorage`-backed
 * propagation. This file pins the invariants the foundation MUST hold so
 * future plumbing commits (Netron header injection, logger bindings,
 * metric exemplars) can extend it without re-deriving the contract.
 *
 * What we pin:
 *   1. ID generation matches W3C: 32-hex traceId, 16-hex spanId, never
 *      the all-zero sentinel.
 *   2. `withTrace`/`currentTrace` survive `await` boundaries — the whole
 *      point of using ALS.
 *   3. `withTrace` is properly scoped: leaving the run restores the prior
 *      context (or undefined). No leakage to sibling frames.
 *   4. `startSpan` produces a child of the current trace if one exists,
 *      a fresh root otherwise. Trace-id is inherited; span-id is not.
 *   5. `traceparent` round-trips: a context formatted to a header and
 *      parsed back yields the SAME traceId (parentSpanId from the wire
 *      becomes the inbound parent — spanId is freshly minted, per W3C).
 *   6. Malformed headers are rejected (returns undefined, never throws).
 */

import { describe, it, expect } from 'vitest';

import {
  INVALID_SPAN_ID,
  INVALID_TRACE_ID,
  TRACE_FLAGS,
  createSpanId,
  createTraceId,
  currentTrace,
  extractTraceparent,
  formatTraceparent,
  makeTraceContext,
  parseTraceparent,
  startSpan,
  withTrace,
} from '../../src/tracing/index.js';

describe('T#73 tracing foundation — primitives', () => {
  describe('id generation', () => {
    it('createTraceId returns 32 lowercase hex chars, never all-zero', () => {
      for (let i = 0; i < 64; i++) {
        const id = createTraceId();
        expect(id).toHaveLength(32);
        expect(id).toMatch(/^[0-9a-f]{32}$/);
        expect(id).not.toBe(INVALID_TRACE_ID);
      }
    });

    it('createSpanId returns 16 lowercase hex chars, never all-zero', () => {
      for (let i = 0; i < 64; i++) {
        const id = createSpanId();
        expect(id).toHaveLength(16);
        expect(id).toMatch(/^[0-9a-f]{16}$/);
        expect(id).not.toBe(INVALID_SPAN_ID);
      }
    });

    it('successive ids are unique (probabilistic)', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 1000; i++) seen.add(createSpanId());
      expect(seen.size).toBe(1000);
    });
  });

  describe('AsyncLocalStorage propagation', () => {
    it('currentTrace returns undefined outside a withTrace scope', () => {
      expect(currentTrace()).toBeUndefined();
    });

    it('currentTrace surfaces the active context inside withTrace', () => {
      const ctx = makeTraceContext({ traceId: createTraceId(), spanId: createSpanId() });
      withTrace(ctx, () => {
        expect(currentTrace()).toBe(ctx);
      });
    });

    it('context survives across await boundaries', async () => {
      const ctx = makeTraceContext({ traceId: createTraceId(), spanId: createSpanId() });
      await withTrace(ctx, async () => {
        expect(currentTrace()?.spanId).toBe(ctx.spanId);
        await new Promise((r) => setTimeout(r, 5));
        expect(currentTrace()?.spanId).toBe(ctx.spanId);
        await Promise.resolve();
        expect(currentTrace()?.spanId).toBe(ctx.spanId);
      });
    });

    it('exiting withTrace restores prior context (or undefined)', () => {
      const outer = makeTraceContext({ traceId: createTraceId(), spanId: createSpanId() });
      const inner = makeTraceContext({ traceId: createTraceId(), spanId: createSpanId() });

      expect(currentTrace()).toBeUndefined();
      withTrace(outer, () => {
        expect(currentTrace()).toBe(outer);
        withTrace(inner, () => {
          expect(currentTrace()).toBe(inner);
        });
        // After the inner run, outer is restored.
        expect(currentTrace()).toBe(outer);
      });
      // After the outer run, undefined is restored.
      expect(currentTrace()).toBeUndefined();
    });

    it('sibling concurrent withTrace runs do not leak into each other', async () => {
      const a = makeTraceContext({ traceId: createTraceId(), spanId: createSpanId() });
      const b = makeTraceContext({ traceId: createTraceId(), spanId: createSpanId() });

      const aIds: (string | undefined)[] = [];
      const bIds: (string | undefined)[] = [];

      await Promise.all([
        withTrace(a, async () => {
          for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 1));
            aIds.push(currentTrace()?.spanId);
          }
        }),
        withTrace(b, async () => {
          for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 1));
            bIds.push(currentTrace()?.spanId);
          }
        }),
      ]);

      // Every observation inside the `a` run saw `a.spanId`; same for `b`.
      // If ALS scoping were wrong, we'd see cross-contamination here.
      expect(aIds.every((id) => id === a.spanId)).toBe(true);
      expect(bIds.every((id) => id === b.spanId)).toBe(true);
    });
  });

  describe('startSpan', () => {
    it('with no current trace, returns a fresh root span (no parent)', () => {
      const root = startSpan();
      expect(root.parentSpanId).toBeUndefined();
      expect(root.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(root.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(root.flags & TRACE_FLAGS.SAMPLED).toBe(TRACE_FLAGS.SAMPLED);
    });

    it('with a current trace, inherits traceId and sets parentSpanId', () => {
      const parent = makeTraceContext({ traceId: createTraceId(), spanId: createSpanId() });
      withTrace(parent, () => {
        const child = startSpan();
        expect(child.traceId).toBe(parent.traceId);
        expect(child.parentSpanId).toBe(parent.spanId);
        expect(child.spanId).not.toBe(parent.spanId);
        expect(child.flags).toBe(parent.flags);
      });
    });

    it('explicit parent overrides the ambient current trace', () => {
      const ambient = makeTraceContext({ traceId: createTraceId(), spanId: createSpanId() });
      const explicit = makeTraceContext({ traceId: createTraceId(), spanId: createSpanId() });
      withTrace(ambient, () => {
        const child = startSpan(explicit);
        expect(child.traceId).toBe(explicit.traceId);
        expect(child.parentSpanId).toBe(explicit.spanId);
      });
    });

    it('start + withTrace composes for nested spans', () => {
      withTrace(startSpan(), () => {
        const outerId = currentTrace()!.spanId;
        withTrace(startSpan(), () => {
          const inner = currentTrace()!;
          expect(inner.parentSpanId).toBe(outerId);
          expect(inner.traceId).toBe(currentTrace()!.traceId);
        });
      });
    });
  });

  describe('W3C traceparent round-trip', () => {
    it('format emits a parseable W3C header', () => {
      const ctx = makeTraceContext({
        traceId: 'abcdef0123456789abcdef0123456789',
        spanId: 'abcdef0123456789',
        flags: TRACE_FLAGS.SAMPLED,
      });
      const wire = formatTraceparent(ctx);
      expect(wire).toBe('00-abcdef0123456789abcdef0123456789-abcdef0123456789-01');
    });

    it('parse extracts the inbound traceId and treats its spanId as our parent', () => {
      const ctx = makeTraceContext({ traceId: createTraceId(), spanId: createSpanId() });
      const wire = formatTraceparent(ctx);

      const restored = parseTraceparent(wire)!;
      expect(restored.traceId).toBe(ctx.traceId);
      // Per W3C: the inbound spanId is the upstream's, so on this hop it
      // becomes parentSpanId — and we mint our own fresh spanId.
      expect(restored.parentSpanId).toBe(ctx.spanId);
      expect(restored.spanId).not.toBe(ctx.spanId);
      expect(restored.flags).toBe(ctx.flags);
    });

    it('format → parse → format yields the same traceId', () => {
      const ctx = makeTraceContext({ traceId: createTraceId(), spanId: createSpanId() });
      const round1 = parseTraceparent(formatTraceparent(ctx))!;
      const round2 = parseTraceparent(formatTraceparent(round1))!;
      expect(round1.traceId).toBe(ctx.traceId);
      expect(round2.traceId).toBe(ctx.traceId);
      // Each hop produces a fresh spanId.
      expect(round1.spanId).not.toBe(round2.spanId);
    });

    it('rejects malformed headers without throwing', () => {
      expect(parseTraceparent(undefined)).toBeUndefined();
      expect(parseTraceparent(null)).toBeUndefined();
      expect(parseTraceparent('')).toBeUndefined();
      expect(parseTraceparent('bogus')).toBeUndefined();
      // Wrong segment count.
      expect(parseTraceparent('00-abc-def')).toBeUndefined();
      // All-zero sentinels are explicitly forbidden by W3C.
      expect(parseTraceparent(`00-${INVALID_TRACE_ID}-abcdef0123456789-01`)).toBeUndefined();
      expect(parseTraceparent(`00-${'a'.repeat(32)}-${INVALID_SPAN_ID}-01`)).toBeUndefined();
      // Wrong lengths.
      expect(parseTraceparent('00-abc-abcdef0123456789-01')).toBeUndefined();
      expect(parseTraceparent('00-abcdef0123456789abcdef0123456789-abc-01')).toBeUndefined();
      // Forbidden version (ff is reserved as invalid in the W3C spec).
      expect(parseTraceparent('ff-abcdef0123456789abcdef0123456789-abcdef0123456789-01')).toBeUndefined();
      // Non-hex.
      expect(parseTraceparent('00-GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG-abcdef0123456789-01')).toBeUndefined();
    });

    it('extractTraceparent works with both Headers and plain objects', () => {
      const ctx = makeTraceContext({ traceId: createTraceId(), spanId: createSpanId() });
      const wire = formatTraceparent(ctx);

      // Plain object — case-insensitive lookup.
      expect(extractTraceparent({ traceparent: wire })?.traceId).toBe(ctx.traceId);
      expect(extractTraceparent({ Traceparent: wire })?.traceId).toBe(ctx.traceId);
      expect(extractTraceparent({ TRACEPARENT: wire })?.traceId).toBe(ctx.traceId);

      // Array form (Node's lower-level http headers can be string[]).
      expect(extractTraceparent({ traceparent: [wire] })?.traceId).toBe(ctx.traceId);

      // Fetch-style Headers instance.
      const fetchHeaders = new Headers({ traceparent: wire });
      expect(extractTraceparent(fetchHeaders)?.traceId).toBe(ctx.traceId);

      // Missing → undefined, never a throw.
      expect(extractTraceparent({})).toBeUndefined();
      expect(extractTraceparent(undefined)).toBeUndefined();
      expect(extractTraceparent(null)).toBeUndefined();
    });
  });

  describe('end-to-end propagation scenario', () => {
    it("simulates a 2-hop RPC: caller emits traceparent, callee resumes the trace", async () => {
      // ── Caller side ───────────────────────────────────────────────
      const callerOutbound: string[] = [];
      const callerSpan = startSpan();

      await withTrace(callerSpan, async () => {
        // Imagine this is Netron emitting an RPC packet — it serialises
        // the current trace as a W3C header onto the wire.
        const ambient = currentTrace()!;
        callerOutbound.push(formatTraceparent(ambient));
      });

      // ── Callee side ───────────────────────────────────────────────
      // The wire payload arrives on the remote process. The Netron
      // receive path parses the header and installs the resumed context
      // before invoking the user handler.
      const wire = callerOutbound[0]!;
      const resumed = parseTraceparent(wire)!;

      let observedTraceId: string | undefined;
      let observedParent: string | undefined;
      await withTrace(resumed, async () => {
        // User handler runs here. Any log line / metric / nested RPC
        // sees `currentTrace()` set to a span whose traceId matches the
        // caller's, with the caller's span as our parent.
        observedTraceId = currentTrace()!.traceId;
        observedParent = currentTrace()!.parentSpanId;
      });

      expect(observedTraceId).toBe(callerSpan.traceId);
      expect(observedParent).toBe(callerSpan.spanId);
    });
  });
});
