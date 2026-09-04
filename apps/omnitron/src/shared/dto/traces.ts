/**
 * Trace DTOs — wire shapes shared with the Omnitron Console.
 *
 * Declared away from the service implementation for the reason set out in
 * `./auth.ts`: a DTO that imports from an implementation drags decorators and
 * the server's dependency graph into the console's build.
 */

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
