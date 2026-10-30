/** Browser-safe contracts exported by Titan; no duplicated wire shapes. */
import type { MetricsSnapshot } from '@omnitron-dev/titan-metrics/types';
export type { MetricsQueryFilter, MetricsTimeSeries, MetricsSnapshot, MetricsStorageStatus } from '@omnitron-dev/titan-metrics/types';
export type MetricsAppSnapshot = MetricsSnapshot['apps'][string];
