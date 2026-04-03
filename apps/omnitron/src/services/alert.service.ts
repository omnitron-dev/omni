/**
 * Alert Service — Rule-based alerting engine
 *
 * Evaluates alert rules at configurable intervals and fires/resolves alerts.
 * Supports three rule types:
 *   - metric: threshold-based (e.g., CPU > 80%)
 *   - log: pattern matching (e.g., level=error AND app=main count > 10/5min)
 *   - health: health status changes (e.g., app goes unhealthy)
 *
 * Alert lifecycle: pending → firing → resolved (or silenced/acknowledged)
 *
 * Stores alert rules and events in omnitron-pg.
 */

import type { Kysely } from 'kysely';
import type { OmnitronDatabase } from '../database/schema.js';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';

// =============================================================================
// Types
// =============================================================================

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertRuleType = 'metric' | 'log' | 'health';
export type AlertEventStatus = 'firing' | 'resolved' | 'silenced' | 'acknowledged';

export interface AlertRule {
  id: string;
  name: string;
  expression: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  forDuration: number | null;
  annotations: Record<string, unknown> | null;
  labels: Record<string, unknown> | null;
  enabled: boolean;
  lastEvaluatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  status: AlertEventStatus;
  value: string | null;
  annotations: Record<string, unknown> | null;
  firedAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export interface AlertSummary {
  firing: number;
  resolved: number;
  silenced: number;
  total: number;
  bySeverity: Record<string, number>;
}

// =============================================================================
// Built-in Alert Expressions (simple DSL)
// =============================================================================

/**
 * Parse a simple alert expression.
 * Examples:
 *   "app.main.status != online"
 *   "app.*.cpu > 80"
 *   "infra.postgres.health != healthy"
 *   "log.error.count > 10 in 5m"
 */
interface EvalContext {
  apps: Array<{ name: string; status: string; cpu: number; memory: number }>;
  infra: Record<string, { status: string; health: string }>;
  logCounts?: Record<string, number>; // level → count in window
}

function evaluateExpression(expr: string, ctx: EvalContext): { firing: boolean; value: string } {
  const trimmed = expr.trim();

  // app.<name>.status != online
  const appStatusMatch = trimmed.match(/^app\.(\*|[\w-]+)\.status\s*(!=|==)\s*(\w+)$/);
  if (appStatusMatch) {
    const [, appName, op, expected] = appStatusMatch;
    const targets = appName === '*' ? ctx.apps : ctx.apps.filter((a) => a.name === appName);
    const violations = targets.filter((a) => (op === '!=' ? a.status !== expected : a.status === expected));
    return {
      firing: violations.length > 0,
      value: violations.map((a) => `${a.name}=${a.status}`).join(', '),
    };
  }

  // app.<name>.cpu > N
  const appMetricMatch = trimmed.match(/^app\.(\*|[\w-]+)\.(cpu|memory)\s*(>|<|>=|<=)\s*(\d+)$/);
  if (appMetricMatch) {
    const [, appName, metric, op, thresholdStr] = appMetricMatch;
    const threshold = Number(thresholdStr);
    const targets = appName === '*' ? ctx.apps : ctx.apps.filter((a) => a.name === appName);
    const violations = targets.filter((a) => {
      const val = metric === 'cpu' ? a.cpu : a.memory;
      switch (op) {
        case '>': return val > threshold;
        case '<': return val < threshold;
        case '>=': return val >= threshold;
        case '<=': return val <= threshold;
        default: return false;
      }
    });
    return {
      firing: violations.length > 0,
      value: violations.map((a) => `${a.name}=${metric === 'cpu' ? a.cpu.toFixed(1) : a.memory}`).join(', '),
    };
  }

  // infra.<service>.health != healthy
  const infraMatch = trimmed.match(/^infra\.(\*|[\w-]+)\.health\s*(!=|==)\s*(\w+)$/);
  if (infraMatch) {
    const [, svcName = '*', op = '!=', expected = 'healthy'] = infraMatch;
    const entries = svcName === '*'
      ? Object.entries(ctx.infra)
      : Object.entries(ctx.infra).filter(([k]) => k === svcName || k.includes(svcName));
    const violations = entries.filter(([, v]) => (op === '!=' ? v.health !== expected : v.health === expected));
    return {
      firing: violations.length > 0,
      value: violations.map(([k, v]) => `${k}=${v.health}`).join(', '),
    };
  }

  // Fallback: always false for unparseable expressions
  return { firing: false, value: 'unparseable expression' };
}

// =============================================================================
// Service
// =============================================================================

export class AlertService {
  private evaluationTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Kysely<OmnitronDatabase>,
    private readonly orchestrator: OrchestratorService,
    private readonly infraState: () => Record<string, { status: string; health: string }>
  ) {}

  /**
   * Start the alert evaluation loop.
   * Runs every `intervalMs` (default 15s).
   */
  start(intervalMs = 15_000): void {
    if (this.evaluationTimer) return;
    this.evaluationTimer = setInterval(() => {
      this.evaluate().catch(() => {});
    }, intervalMs);
    this.evaluationTimer.unref();
  }

  stop(): void {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
  }

  /**
   * Evaluate all enabled alert rules.
   */
  async evaluate(): Promise<void> {
    const rules = await this.db
      .selectFrom('alert_rules')
      .selectAll()
      .where('enabled', '=', true)
      .execute();

    if (rules.length === 0) return;

    // Build evaluation context
    const apps = this.orchestrator.list();
    const infra = this.infraState();

    const ctx: EvalContext = {
      apps: apps.map((a) => ({ name: a.name, status: a.status, cpu: a.cpu, memory: a.memory })),
      infra,
    };

    for (const rule of rules) {
      const { firing, value } = evaluateExpression(rule.expression, ctx);

      // Get current firing alert for this rule (if any)
      const currentAlert = await this.db
        .selectFrom('alert_events')
        .selectAll()
        .where('ruleId', '=', rule.id)
        .where('status', '=', 'firing')
        .executeTakeFirst();

      if (firing && !currentAlert) {
        // New alert — create firing event
        await this.db.insertInto('alert_events').values({
          ruleId: rule.id,
          status: 'firing',
          value,
          annotations: rule.annotations ? (JSON.stringify(rule.annotations) as any) : null,
          firedAt: new Date(),
        } as any).execute();
      } else if (!firing && currentAlert) {
        // Alert resolved
        await this.db
          .updateTable('alert_events')
          .set({ status: 'resolved', resolvedAt: new Date() } as any)
          .where('id', '=', currentAlert.id)
          .execute();
      }

      // Update last evaluated timestamp
      await this.db
        .updateTable('alert_rules')
        .set({ lastEvaluatedAt: new Date() } as any)
        .where('id', '=', rule.id)
        .execute();
    }
  }

  // ===========================================================================
  // CRUD
  // ===========================================================================

  async getRules(): Promise<AlertRule[]> {
    const rows = await this.db.selectFrom('alert_rules').selectAll().orderBy('createdAt', 'desc').execute();
    return rows.map(mapRule);
  }

  async createRule(rule: Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt' | 'lastEvaluatedAt'>): Promise<AlertRule> {
    const row = await this.db.insertInto('alert_rules').values({
      name: rule.name,
      expression: rule.expression,
      type: rule.type,
      severity: rule.severity,
      forDuration: rule.forDuration ?? null,
      annotations: rule.annotations ? (JSON.stringify(rule.annotations) as any) : null,
      labels: rule.labels ? (JSON.stringify(rule.labels) as any) : null,
      enabled: rule.enabled,
    } as any).returningAll().executeTakeFirstOrThrow();
    return mapRule(row);
  }

  async updateRule(id: string, updates: Partial<Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'>>): Promise<AlertRule> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) set['name'] = updates.name;
    if (updates.expression !== undefined) set['expression'] = updates.expression;
    if (updates.severity !== undefined) set['severity'] = updates.severity;
    if (updates.enabled !== undefined) set['enabled'] = updates.enabled;
    if (updates.forDuration !== undefined) set['forDuration'] = updates.forDuration;

    const row = await this.db.updateTable('alert_rules').set(set as any).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    return mapRule(row);
  }

  async deleteRule(id: string): Promise<void> {
    await this.db.deleteFrom('alert_rules').where('id', '=', id).execute();
  }

  async getEvents(options?: { ruleId?: string; status?: string; limit?: number }): Promise<AlertEvent[]> {
    let query = this.db.selectFrom('alert_events').selectAll().orderBy('firedAt', 'desc').limit(options?.limit ?? 50);
    if (options?.ruleId) query = query.where('ruleId', '=', options.ruleId);
    if (options?.status) query = query.where('status', '=', options.status);
    const rows = await query.execute();
    return rows.map(mapEvent);
  }

  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void> {
    await this.db.updateTable('alert_events').set({
      acknowledgedAt: new Date(),
      acknowledgedBy,
    } as any).where('id', '=', alertId).execute();
  }

  async getSummary(): Promise<AlertSummary> {
    // Count events by status using SQL GROUP BY (avoids loading all rows)
    const statusCounts = await this.db
      .selectFrom('alert_events')
      .select(['status'])
      .select((eb) => eb.fn.count<string>('id').as('count'))
      .groupBy('status')
      .execute();

    let firing = 0;
    let resolved = 0;
    let silenced = 0;
    let total = 0;

    for (const row of statusCounts) {
      const count = Number(row.count);
      total += count;
      switch (row.status) {
        case 'firing': firing = count; break;
        case 'resolved': resolved = count; break;
        case 'silenced': silenced = count; break;
        default: break;
      }
    }

    // Count firing alerts by severity using SQL GROUP BY + JOIN
    const bySeverity: Record<string, number> = {};
    const severityCounts = await this.db
      .selectFrom('alert_events')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_events.ruleId')
      .select(['alert_rules.severity'])
      .select((eb) => eb.fn.count<string>('alert_events.id').as('count'))
      .where('alert_events.status', '=', 'firing')
      .groupBy('alert_rules.severity')
      .execute();

    for (const row of severityCounts) {
      bySeverity[row.severity] = Number(row.count);
    }

    return { firing, resolved, silenced, total, bySeverity };
  }
}

// =============================================================================
// Mappers
// =============================================================================

function mapRule(row: any): AlertRule {
  return {
    id: row.id,
    name: row.name,
    expression: row.expression,
    type: row.type,
    severity: row.severity,
    forDuration: row.forDuration ?? null,
    annotations: row.annotations ? (typeof row.annotations === 'string' ? JSON.parse(row.annotations) : row.annotations) : null,
    labels: row.labels ? (typeof row.labels === 'string' ? JSON.parse(row.labels) : row.labels) : null,
    enabled: row.enabled,
    lastEvaluatedAt: row.lastEvaluatedAt ? (row.lastEvaluatedAt instanceof Date ? row.lastEvaluatedAt.toISOString() : String(row.lastEvaluatedAt)) : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

function mapEvent(row: any): AlertEvent {
  return {
    id: row.id,
    ruleId: row.ruleId,
    status: row.status,
    value: row.value ?? null,
    annotations: row.annotations ? (typeof row.annotations === 'string' ? JSON.parse(row.annotations) : row.annotations) : null,
    firedAt: row.firedAt instanceof Date ? row.firedAt.toISOString() : String(row.firedAt),
    resolvedAt: row.resolvedAt ? (row.resolvedAt instanceof Date ? row.resolvedAt.toISOString() : String(row.resolvedAt)) : null,
    acknowledgedAt: row.acknowledgedAt ? (row.acknowledgedAt instanceof Date ? row.acknowledgedAt.toISOString() : String(row.acknowledgedAt)) : null,
    acknowledgedBy: row.acknowledgedBy ?? null,
  };
}
