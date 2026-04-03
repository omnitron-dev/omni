/**
 * TraceCollectorService — OTLP-compatible distributed trace collection
 *
 * Collects spans from Netron RPC calls and stores them in omnitron-pg
 * for querying and visualization. Supports:
 * - Single span and batch ingestion
 * - Trace reconstruction from spans
 * - Service map generation
 * - Filtering by service, operation, duration, tags, time range
 *
 * Ingestion is write-buffered for performance — spans are batched and
 * flushed to PG at configurable intervals.
 */

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { OmnitronDatabase } from '../database/schema.js';

// =============================================================================
// Types
// =============================================================================

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  duration: number;
  status: 'ok' | 'error';
  tags: Record<string, string>;
  logs?: Array<{ timestamp: string; message: string }>;
}

export interface Trace {
  traceId: string;
  spans: TraceSpan[];
  duration: number;
  serviceName: string;
  operationName: string;
  startTime: string;
}

export interface TraceFilter {
  service?: string;
  operation?: string;
  minDuration?: number;
  maxDuration?: number;
  from?: string;
  to?: string;
  limit?: number;
  tags?: Record<string, string>;
}

export interface ServiceMapEntry {
  source: string;
  target: string;
  callCount: number;
  avgDuration: number;
  errorRate: number;
}

// =============================================================================
// Service
// =============================================================================

export class TraceCollectorService {
  private buffer: TraceSpan[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly flushInterval = 5_000;
  private readonly maxBufferSize = 500;

  constructor(
    private readonly db: Kysely<OmnitronDatabase>,
    private readonly logger: ILogger
  ) {}

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  start(): void {
    this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
    this.flushTimer.unref();
    this.logger.info('Trace collector started');
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  // ===========================================================================
  // Ingestion
  // ===========================================================================

  async ingestSpan(span: TraceSpan): Promise<void> {
    this.buffer.push(span);
    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush();
    }
  }

  async ingestBatch(spans: TraceSpan[]): Promise<void> {
    this.buffer.push(...spans);
    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush();
    }
  }

  // ===========================================================================
  // Query
  // ===========================================================================

  async getTrace(traceId: string): Promise<Trace | null> {
    const rows = await this.db
      .selectFrom('traces' as any)
      .selectAll()
      .where('traceId', '=', traceId)
      .orderBy('startTime', 'asc')
      .execute();

    if (rows.length === 0) return null;

    const spans = rows.map((r: any) => this.mapSpan(r));
    const root = spans.find((s) => !s.parentSpanId) ?? spans[0]!;

    return {
      traceId,
      spans,
      duration: spans.reduce((max, s) => Math.max(max, s.duration), 0),
      serviceName: root.serviceName,
      operationName: root.operationName,
      startTime: root.startTime,
    };
  }

  async queryTraces(filter: TraceFilter): Promise<Trace[]> {
    const limit = filter.limit ?? 50;

    // Query distinct trace IDs matching the filter, then fetch full traces
    let query = this.db
      .selectFrom('traces' as any)
      .select(['traceId'])
      .distinct();

    if (filter.service) {
      query = query.where('serviceName', '=', filter.service);
    }
    if (filter.operation) {
      query = query.where('operationName', '=', filter.operation);
    }
    if (filter.minDuration != null) {
      query = query.where('duration', '>=', filter.minDuration);
    }
    if (filter.maxDuration != null) {
      query = query.where('duration', '<=', filter.maxDuration);
    }
    if (filter.from) {
      query = query.where('startTime', '>=', new Date(filter.from));
    }
    if (filter.to) {
      query = query.where('startTime', '<=', new Date(filter.to));
    }
    if (filter.tags) {
      for (const [key, value] of Object.entries(filter.tags)) {
        query = query.where(sql`tags->>${sql.lit(key)}` as any, '=', value);
      }
    }

    const traceIds = await query
      .orderBy('startTime' as any, 'desc')
      .limit(limit)
      .execute();

    const traces: Trace[] = [];
    for (const row of traceIds) {
      const trace = await this.getTrace((row as any).traceId);
      if (trace) traces.push(trace);
    }

    return traces;
  }

  async getServiceMap(): Promise<ServiceMapEntry[]> {
    // Query parent-child span pairs to build service-to-service call map
    const rows = await sql`
      SELECT
        parent.service_name AS source,
        child.service_name AS target,
        COUNT(*) AS call_count,
        AVG(child.duration) AS avg_duration,
        SUM(CASE WHEN child.status = 'error' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) AS error_rate
      FROM traces child
      JOIN traces parent ON child.trace_id = parent.trace_id AND child.parent_span_id = parent.span_id
      WHERE parent.service_name != child.service_name
      GROUP BY parent.service_name, child.service_name
      ORDER BY call_count DESC
      LIMIT 100
    `.execute(this.db);

    return (rows.rows as any[]).map((r) => ({
      source: r.source,
      target: r.target,
      callCount: Number(r.call_count),
      avgDuration: Math.round(Number(r.avg_duration)),
      errorRate: Number(r.error_rate ?? 0),
    }));
  }

  // ===========================================================================
  // Private — Flush buffer to PG
  // ===========================================================================

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const spans = this.buffer.splice(0);

    try {
      const values = spans.map((s) => ({
        traceId: s.traceId,
        spanId: s.spanId,
        parentSpanId: s.parentSpanId,
        operationName: s.operationName,
        serviceName: s.serviceName,
        startTime: new Date(s.startTime),
        endTime: new Date(s.endTime),
        duration: s.duration,
        status: s.status,
        tags: JSON.stringify(s.tags),
        logs: s.logs ? JSON.stringify(s.logs) : null,
      }));

      await this.db
        .insertInto('traces' as any)
        .values(values as any)
        .execute();
    } catch (err) {
      this.logger.error(
        { error: (err as Error).message, count: spans.length },
        'Failed to flush trace spans to PG'
      );
      // Re-add to buffer (with size limit to prevent memory leak)
      if (this.buffer.length < this.maxBufferSize * 2) {
        this.buffer.unshift(...spans);
      }
    }
  }

  // ===========================================================================
  // Mappers
  // ===========================================================================

  private mapSpan(row: any): TraceSpan {
    return {
      traceId: row.traceId ?? row.trace_id,
      spanId: row.spanId ?? row.span_id,
      parentSpanId: row.parentSpanId ?? row.parent_span_id ?? null,
      operationName: row.operationName ?? row.operation_name,
      serviceName: row.serviceName ?? row.service_name,
      startTime: row.startTime instanceof Date ? row.startTime.toISOString() : String(row.startTime ?? row.start_time),
      endTime: row.endTime instanceof Date ? row.endTime.toISOString() : String(row.endTime ?? row.end_time),
      duration: Number(row.duration),
      status: row.status,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags ?? {},
      logs: row.logs ? (typeof row.logs === 'string' ? JSON.parse(row.logs) : row.logs) : undefined,
    };
  }
}
