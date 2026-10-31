import { randomUUID } from 'node:crypto';
import type { LogRecord } from './log-line.js';
import type { LogEntry } from '../shared/dto/logs.js';

/** Files, local DB and replication use the same identity and timestamp. */
export function logEntryOf(app: string, record: LogRecord): LogEntry & { id: string } {
  const parsed = record.data ?? {};
  const { level: _level, msg: _msg, message: _message, time: _time, ...rest } = parsed;
  return {
    id: record.id ?? randomUUID(), app, level: record.level,
    message: record.message || record.raw || '',
    timestamp: record.timestamp ?? new Date(record.time).toISOString(),
    ...(parsed['labels'] && typeof parsed['labels'] === 'object' ? { labels: parsed['labels'] as Record<string, unknown> } : {}),
    ...(typeof (parsed['traceId'] ?? parsed['trace_id']) === 'string' ? { traceId: (parsed['traceId'] ?? parsed['trace_id']) as string } : {}),
    ...(typeof (parsed['spanId'] ?? parsed['span_id']) === 'string' ? { spanId: (parsed['spanId'] ?? parsed['span_id']) as string } : {}),
    metadata: { ...rest, ...(record.capture ? { _omnitron: { ...record.capture, eventTime: record.timestamp ?? new Date(record.time).toISOString(), lines: record.lines } } : {}) },
  };
}
