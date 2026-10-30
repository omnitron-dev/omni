import { HealthIndicator, type HealthIndicatorResult } from '@omnitron-dev/titan-health';
import type { IMetricsService } from '@omnitron-dev/titan-metrics';
import { metricsStorageReading } from '../shared/metrics-storage-reading.js';

export class MetricsStorageIndicator extends HealthIndicator {
  readonly name = 'metrics-storage';
  constructor(private readonly metrics: IMetricsService) { super(); }
  async check(): Promise<HealthIndicatorResult> {
    const status = this.metrics.getStorageStatus();
    const reading = metricsStorageReading(status);
    return reading.severity === 'warning'
      ? this.degraded(`${reading.summary}. ${reading.detail}`, { ...status })
      : this.healthy(`${reading.summary}. ${reading.detail}`, { ...status });
  }
}
