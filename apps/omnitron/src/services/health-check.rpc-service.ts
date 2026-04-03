/**
 * Health Check RPC Service
 *
 * Netron RPC endpoints for composable health checks from webapp and CLI.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES } from '../shared/roles.js';
import type { HealthCheckService, HealthReport, PlatformHealthReport } from './health-check.service.js';

@Service({ name: 'OmnitronHealth' })
export class HealthCheckRpcService {
  constructor(private readonly healthCheck: HealthCheckService) {}

  @Public({ auth: { roles: VIEWER_ROLES } })
  async checkApp(data: { appName: string; port?: number }): Promise<HealthReport> {
    return this.healthCheck.checkApp(data.appName, data.port);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async checkApps(): Promise<HealthReport> {
    return this.healthCheck.checkApps();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async checkInfrastructure(): Promise<HealthReport> {
    return this.healthCheck.checkInfrastructure();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async checkAll(): Promise<PlatformHealthReport> {
    return this.healthCheck.checkAll();
  }
}
