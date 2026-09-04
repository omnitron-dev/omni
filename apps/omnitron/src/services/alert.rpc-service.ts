/**
 * Alert RPC Service
 *
 * Netron RPC endpoints for alert management from webapp.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES, OPERATOR_ROLES } from '../shared/roles.js';
import type { AlertService } from './alert.service.js';
import type { AlertRule, AlertEvent, AlertSummary, ActiveAlert, CreateAlertRuleInput } from '../shared/dto/alerts.js';
import type { IOmnitronAlertsService } from '../shared/dto/services.js';

@Service({ name: 'OmnitronAlerts' })
export class AlertRpcService implements IOmnitronAlertsService {
  constructor(private readonly alertService: AlertService) {}

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getRules(): Promise<AlertRule[]> {
    return this.alertService.getRules();
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async createRule(data: CreateAlertRuleInput): Promise<AlertRule> {
    return this.alertService.createRule({
      name: data.name,
      expression: data.expression,
      type: data.type as any,
      severity: data.severity as any,
      forDuration: data.forDuration ?? null,
      annotations: null,
      labels: null,
      enabled: data.enabled ?? true,
    });
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async updateRule(data: { id: string; updates: Partial<AlertRule> }): Promise<AlertRule> {
    return this.alertService.updateRule(data.id, data.updates);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async deleteRule(data: { id: string }): Promise<{ success: boolean }> {
    await this.alertService.deleteRule(data.id);
    return { success: true };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getEvents(data?: { ruleId?: string; status?: string; limit?: number }): Promise<AlertEvent[]> {
    return this.alertService.getEvents(data);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async acknowledgeAlert(data: { alertId: string; acknowledgedBy: string }): Promise<{ success: boolean }> {
    await this.alertService.acknowledgeAlert(data.alertId, data.acknowledgedBy);
    return { success: true };
  }

  /** Firing + acknowledged alerts joined with their rule — what the console lists. */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getActiveAlerts(data?: { limit?: number }): Promise<ActiveAlert[]> {
    return this.alertService.getActiveAlerts(data?.limit);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getSummary(): Promise<AlertSummary> {
    return this.alertService.getSummary();
  }
}
