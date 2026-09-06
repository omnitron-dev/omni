/**
 * Log DTOs — the wire shapes of the OmnitronLogs service.
 *
 * Declared here rather than in `services/log-collector.service.ts` for the
 * same reason as the auth DTOs: the console consumes them, and a DTO that
 * imports from a service implementation drags the server's type graph
 * (decorators, Kysely, pino) into the browser build. See `./auth.ts`.
 */

export interface LogEntry {
  app: string;
  level: string;
  message: string;
  timestamp?: Date | string;
  nodeId?: string;
  labels?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  metadata?: Record<string, unknown>;
}

export interface LogQueryFilter {
  app?: string | undefined;
  /**
   * Restrict to one cluster node.
   *
   * `logs.nodeId` is populated by `SyncService.ingestLog` for everything a
   * slave sends up; locally collected entries leave it null, so filtering by
   * a node correctly excludes the master's own output.
   */
  nodeId?: string | undefined;
  level?: string | string[] | undefined;
  search?: string | undefined;
  labels?: Record<string, string> | undefined;
  traceId?: string | undefined;
  from?: Date | string | undefined;
  to?: Date | string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface LogEntryRow {
  id: string;
  timestamp: Date;
  nodeId: string | null;
  app: string;
  level: string;
  message: string;
  labels: Record<string, unknown> | null;
  traceId: string | null;
  spanId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface LogQueryResult {
  entries: LogEntryRow[];
  total: number;
  hasMore: boolean;
}

export interface LogStats {
  byApp: Array<{ app: string; count: number }>;
  byLevel: Array<{ level: string; count: number }>;
  totalCount: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}
