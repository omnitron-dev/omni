/**
 * Trace Collector RPC Service
 *
 * Netron RPC endpoints for distributed trace ingestion and querying.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES } from '../shared/roles.js';
import type {
  TraceCollectorService,
  TraceSpan,
  Trace,
  TraceFilter,
  ServiceMapEntry,
} from './trace-collector.service.js';

@Service({ name: 'OmnitronTraces' })
export class TraceRpcService {
  constructor(private readonly traces: TraceCollectorService) {}

  @Public({ auth: { roles: VIEWER_ROLES } })
  async ingestSpan(data: TraceSpan): Promise<{ success: boolean }> {
    await this.traces.ingestSpan(data);
    return { success: true };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async ingestBatch(data: { spans: TraceSpan[] }): Promise<{ success: boolean }> {
    await this.traces.ingestBatch(data.spans);
    return { success: true };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getTrace(data: { traceId: string }): Promise<Trace | null> {
    return this.traces.getTrace(data.traceId);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async queryTraces(data: TraceFilter): Promise<Trace[]> {
    return this.traces.queryTraces(data);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getServiceMap(): Promise<ServiceMapEntry[]> {
    return this.traces.getServiceMap();
  }
}
