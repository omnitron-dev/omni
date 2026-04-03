/**
 * Titan Metrics — Netron RPC Service
 *
 * Exposes metrics over Netron for the webapp dashboard and CLI.
 *
 * @module titan-metrics
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import type {
  IMetricsService,
  MetricsSnapshot,
  MetricsQueryFilter,
  MetricsTimeSeries,
} from './types.js';

@Service({ name: 'OmnitronMetrics' })
export class MetricsRpcService {
  constructor(private readonly metrics: IMetricsService) {}

  /**
   * Get a real-time snapshot of all app metrics.
   * Used by the dashboard overview.
   */
  @Public({ auth: { allowAnonymous: true } })
  async getSnapshot(): Promise<MetricsSnapshot> {
    return this.metrics.getSnapshot();
  }

  /**
   * Query time-series data with optional time-bucket aggregation.
   * Used by charts and detailed views.
   */
  @Public({ auth: { allowAnonymous: true } })
  async querySeries(filter: MetricsQueryFilter): Promise<MetricsTimeSeries[]> {
    return this.metrics.querySeries(filter);
  }

  /**
   * Get all metrics in Prometheus exposition text format.
   * Can be scraped by external monitoring systems.
   */
  @Public({ auth: { allowAnonymous: true } })
  async getPrometheusText(): Promise<string> {
    return this.metrics.getPrometheusText();
  }

  /**
   * Trigger retention cleanup manually.
   */
  @Public()
  async cleanup(): Promise<{ cleaned: boolean }> {
    await this.metrics.cleanup();
    return { cleaned: true };
  }

  /**
   * Force flush buffered metrics to storage.
   */
  @Public()
  async flush(): Promise<{ flushed: boolean }> {
    await this.metrics.flush();
    return { flushed: true };
  }
}
