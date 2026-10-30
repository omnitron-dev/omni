import { Service, Public } from '@omnitron-dev/titan/decorators';
import type { IMetricsService, MetricsQueryFilter } from '@omnitron-dev/titan-metrics';
import type { IOmnitronMetricsService } from '../shared/dto/services.js';
import { ADMIN_ROLES, CONTROL_PLANE_READ_ROLES, CONTROL_PLANE_ROLES } from '../shared/roles.js';

/** Omnitron's role policy around Titan's collection, persistence and query API. */
@Service({ name: 'OmnitronMetrics' })
export class OmnitronMetricsRpcService implements IOmnitronMetricsService {
  constructor(private readonly metrics: IMetricsService) {}

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getSnapshot() { return this.metrics.getSnapshot(); }

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async querySeries(filter: MetricsQueryFilter) { return this.metrics.querySeries(filter); }

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getPrometheusText() { return this.metrics.getPrometheusText(); }

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getStorageStatus() { return this.metrics.getStorageStatus(); }

  @Public({ auth: { roles: CONTROL_PLANE_ROLES } })
  async flush() { await this.metrics.flush(); return { flushed: true }; }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async cleanup() { await this.metrics.cleanup(); return { cleaned: true }; }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async evictApp(data: { app: string }) { await this.metrics.evictApp(data.app); return { evicted: true }; }
}
