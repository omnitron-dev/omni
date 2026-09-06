/**
 * Omnitron Logs RPC Service
 *
 * Netron RPC endpoints for querying logs from the webapp.
 * Exposes LogCollectorService query methods over Netron.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES } from '../shared/roles.js';
import type {
  LogCollectorService,
  LogQueryFilter,
  LogQueryResult,
  LogStats,
  LogEntryRow,
} from './log-collector.service.js';

@Service({ name: 'OmnitronLogs' })
export class LogsRpcService {
  constructor(private readonly logCollector: LogCollectorService) {}

  // ===========================================================================
  // Query endpoints
  // ===========================================================================

  @Public({ auth: { roles: VIEWER_ROLES } })
  async queryLogs(data: {
    app?: string;
    level?: string | string[];
    search?: string;
    labels?: Record<string, string>;
    traceId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<LogQueryResult> {
    return this.logCollector.queryLogs(data as LogQueryFilter);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getLogStats(): Promise<LogStats> {
    return this.logCollector.getLogStats();
  }

  /**
   * In-memory ingestion counters — no database work, safe to poll.
   *
   * `getLogStats` above runs three `count(*)` over the whole table (22.5
   * million rows on this host), so it is not an answer to "how fast are logs
   * arriving". This is.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getIngestionStats(): Promise<{ ingestedTotal: number; droppedTotal: number; bufferSize: number }> {
    return this.logCollector.getIngestionStats();
  }

  // ===========================================================================
  // Real-time tailing
  // ===========================================================================

  /**
   * Stream logs — returns recent entries matching the filter.
   * The webapp can poll this endpoint for near-real-time tailing,
   * or we can upgrade to WebSocket push later.
   *
   * Returns the last `tail` entries in chronological order.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async streamLogs(data: {
    app?: string;
    level?: string | string[];
    search?: string;
    /** One cluster node, as on `queryLogs`. */
    nodeId?: string;
    /** jsonb containment, as on `queryLogs`. */
    labels?: Record<string, string>;
    tail?: number;
    since?: string;
  }): Promise<LogEntryRow[]> {
    const filter = { ...data, tail: data.tail ?? 100 } as LogQueryFilter & { tail?: number };

    // If since is provided, only return entries after that timestamp
    if (data.since) {
      filter.from = data.since;
    }

    return this.logCollector.getRecentLogs(filter);
  }
}
