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
/**
 * ANONYMOUS SURFACE — what this service answers without credentials.
 *
 * `getSnapshot()`, `querySeries()` and `getPrometheusText()` carry
 * `@Public({ auth: { allowAnonymous: true } })`; `cleanup()` and `flush()` do
 * not, so the split is already read-vs-write rather than accidental.
 *
 * What the read half discloses is more than the numbers. Metric NAMES and
 * LABELS describe the shape of the system: which services exist, which methods
 * are called, which of them are failing and how often. `getPrometheusText()`
 * returns the whole registry in one call, and `querySeries()` accepts a filter,
 * so an anonymous caller can enumerate rather than sample.
 *
 * Left as it is deliberately: unauthenticated scraping is what Prometheus does,
 * and requiring credentials here breaks the standard integration this format
 * exists for. Whether that port faces anything but the scraper is a property of
 * the DEPLOYMENT, which a package cannot know — and tightening it here would
 * move the failure onto whoever upgraded, not whoever chose the exposure.
 *
 * The requirement this leaves is visibility, not silence: `omnitron doctor`
 * reports the anonymous surface, and this is the explanation an operator should
 * find when they follow it here.
 */
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

  /**
   * Permanently drop every sample for a named app. Used by orchestrators
   * when an app is definitively removed (stack delete, app un-registered)
   * so it doesn't linger as a "ghost offline" entry in subsequent snapshots.
   */
  @Public()
  async evictApp(data: { app: string }): Promise<{ evicted: boolean }> {
    await this.metrics.evictApp(data.app);
    return { evicted: true };
  }
}
