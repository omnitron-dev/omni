/**
 * Deploy RPC Service
 *
 * Netron RPC endpoints for application deployment with strategies,
 * rollback, and deployment history from webapp and CLI.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES, OPERATOR_ROLES } from '../shared/roles.js';
import type { DeployService, DeployResult, DeploymentRecord } from './deploy.service.js';
import type { IOmnitronDeployService } from '../shared/dto/services.js';

@Service({ name: 'OmnitronDeploy' })
export class DeployRpcService implements IOmnitronDeployService {
  constructor(private readonly deploy: DeployService) {}

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async deployApp(data: { app: string; version: string; strategy?: string; deployedBy?: string }): Promise<DeployResult> {
    return this.deploy.deploy({
      app: data.app,
      version: data.version,
      strategy: data.strategy as any,
      deployedBy: data.deployedBy,
    });
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async rollback(data: { app: string; deployedBy?: string }): Promise<DeployResult> {
    return this.deploy.rollback(data.app, data.deployedBy);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getHistory(data?: { app?: string; limit?: number }): Promise<DeploymentRecord[]> {
    return this.deploy.getHistory(data?.app, data?.limit);
  }

  /** Applications the daemon manages, for the console's deploy dialog. */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async listDeployableApps(): Promise<string[]> {
    return this.deploy.listDeployableApps();
  }
}
