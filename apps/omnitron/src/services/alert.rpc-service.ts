/**
 * Alert RPC Service
 *
 * Netron RPC endpoints for alert management from webapp.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';
import { VIEWER_ROLES, OPERATOR_ROLES } from '../shared/roles.js';
import { readAlertRuleFields, type AlertRuleFields } from '../shared/alert-expression.js';
import { requireAuth } from './auth-context.js';
import { requirePayload, requireString } from './anonymous-input.js';
import type { AlertService } from './alert.service.js';
import type {
  AlertRule,
  AlertEvent,
  AlertSummary,
  ActiveAlert,
  CreateAlertRuleInput,
  UpdateAlertRuleInput,
} from '../shared/dto/alerts.js';
import type { IOmnitronAlertsService } from '../shared/dto/services.js';

/** The fields `readAlertRuleFields` checked — the same function the console's form runs. */
function checked(input: unknown, partial: boolean, method: string): Partial<AlertRuleFields> {
  const { fields, problems } = readAlertRuleFields(input, partial);
  if (problems.length > 0) throw Errors.badRequest(`${method}: ${problems.join('; ')}`);
  return fields;
}

@Service({ name: 'OmnitronAlerts' })
export class AlertRpcService implements IOmnitronAlertsService {
  constructor(private readonly alertService: AlertService) {}

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getRules(): Promise<AlertRule[]> {
    return this.alertService.getRules();
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async createRule(data: CreateAlertRuleInput): Promise<AlertRule> {
    return this.alertService.createRule(checked(data, false, 'createRule') as AlertRuleFields);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async updateRule(data: UpdateAlertRuleInput): Promise<AlertRule> {
    const id = requireString(requirePayload(data, 'updateRule'), 'id', 'updateRule');
    return this.alertService.updateRule(id, checked(data, true, 'updateRule'));
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async deleteRule(data: { id: string }): Promise<{ success: boolean }> {
    await this.alertService.deleteRule(requireString(requirePayload(data, 'deleteRule'), 'id', 'deleteRule'));
    return { success: true };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getEvents(data?: { ruleId?: string; status?: string; limit?: number }): Promise<AlertEvent[]> {
    return this.alertService.getEvents(data);
  }

  /** The acknowledger is the caller, from the session — the payload names only the alert. */
  @Public({ auth: { roles: OPERATOR_ROLES } })
  async acknowledgeAlert(data: { alertId: string }): Promise<{ success: boolean }> {
    const alertId = requireString(requirePayload(data, 'acknowledgeAlert'), 'alertId', 'acknowledgeAlert');
    const success = await this.alertService.acknowledgeAlert(alertId, requireAuth().userId);
    return { success };
  }

  /** Firing alerts joined with their rule — what the console lists. */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getActiveAlerts(data?: { limit?: number }): Promise<ActiveAlert[]> {
    return this.alertService.getActiveAlerts(data?.limit);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getSummary(): Promise<AlertSummary> {
    return this.alertService.getSummary();
  }
}
