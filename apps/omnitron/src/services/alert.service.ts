/**
 * Alert Service — rule-based alerting.
 *
 * The daemon scheduler's `alert-evaluation` job calls `evaluate()` every
 * `monitoring.healthCheck.interval` (15 s by default). A rule is an
 * expression of `shared/alert-expression.ts` — an app's status, cpu or
 * memory, or a container's health — and what it watches (`health` or
 * `metric`) is read off it.
 *
 * Lifecycle: a condition that holds becomes PENDING for the rule's
 * `forDuration` (kept in this process: a restart starts the wait again), then
 * FIRING, then RESOLVED when it stops holding. Acknowledging a firing alert
 * records who and when; it stays firing until the condition clears.
 *
 * Rules and events are stored in omnitron-pg; the defaults a fresh master
 * starts with are seeded once by migration 011, and are the operator's after.
 */

import { sql, type Kysely } from 'kysely';
import type { OmnitronDatabase } from '../database/schema.js';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import { Injectable, Inject, Optional } from '@omnitron-dev/titan/decorators';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule, type ILogger } from '@omnitron-dev/titan/module/logger';
import {
  ALERT_EXPRESSION_FORMS,
  ALERT_SEVERITIES,
  alertRuleTypeOf,
  isAlertExpressionParseable,
  type AlertRuleFields,
} from '../shared/alert-expression.js';

export { ALERT_EXPRESSION_FORMS, isAlertExpressionParseable };
import { OMNITRON_DB_TOKEN, ORCHESTRATOR_TOKEN, PROJECT_SERVICE_TOKEN } from '../shared/tokens.js';
import type { ProjectService } from './project.service.js';
import type { ContainerState } from '../infrastructure/types.js';
import type { AlertRule, AlertEvent, AlertSummary, ActiveAlert, AlertSeverity } from '../shared/dto/alerts.js';

// =============================================================================
// Types
// =============================================================================

export type {
  AlertSeverity,
  AlertRuleType,
  AlertEventStatus,
  AlertRule,
  AlertEvent,
  AlertSummary,
  CreateAlertRuleInput,
  UpdateAlertRuleInput,
} from '../shared/dto/alerts.js';

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

function evaluateExpression(
  expr: string,
  ctx: EvalContext
): { firing: boolean; value: string; unparseable?: boolean } {
  const trimmed = expr.trim();

  // app.<name>.status != online
  const appStatusMatch = trimmed.match(ALERT_EXPRESSION_FORMS[0]);
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
  const appMetricMatch = trimmed.match(ALERT_EXPRESSION_FORMS[1]);
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
  const infraMatch = trimmed.match(ALERT_EXPRESSION_FORMS[2]);
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

  // Nothing matched. `firing: false` is what every caller acts on, and it is
  // the same answer a healthy platform gives — so a rule the evaluator
  // cannot read used to sit in the UI enabled, green, and permanently
  // silent. The rule is returned as unparseable and the caller decides;
  // `firing` stays false because firing on a syntax error would page
  // somebody about the wrong thing.
  return { firing: false, value: 'unparseable expression', unparseable: true };
}

/**
 * One word for a container's health, as an `infra.<name>.health` rule reads
 * it: `healthy`, `starting`, `unhealthy` or `stopped`.
 *
 * A container without a healthcheck reports `none`; running is then the only
 * sign there is, and it reads `healthy` — otherwise `infra.*.health !=
 * healthy` would fire for ever on tor and every other image that declares no
 * check. One that is running but detached from every network serves nothing
 * and reads `unhealthy`.
 */
export function containerHealth(state: Pick<ContainerState, 'status' | 'health' | 'networkAttached'>): string {
  if (state.status !== 'running') return 'stopped';
  if (state.networkAttached === false) return 'unhealthy';
  if (state.health === 'unhealthy') return 'unhealthy';
  if (state.health === 'starting') return 'starting';
  return 'healthy';
}

// =============================================================================
// Service
// =============================================================================

@Injectable()
export class AlertService {
  private readonly logger: ILogger;

  /**
   * When each rule's condition began to hold, for a rule that must hold for
   * `forDuration` before it fires. In memory: a daemon restart starts every
   * wait again, which errs toward firing later rather than at once.
   */
  private readonly pendingSince = new Map<string, number>();

  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) loggerModule: ILoggerModule,
    @Inject(OMNITRON_DB_TOKEN) private readonly db: Kysely<OmnitronDatabase>,
    @Inject(ORCHESTRATOR_TOKEN) private readonly orchestrator: OrchestratorService,
    // The containers are the stacks', and the stacks are the project
    // service's. This was an accessor token wired to `() => ({})`: every
    // `infra.…` rule — which the console's form accepts as supported — was
    // evaluated against no containers at all and could never fire.
    @Optional() @Inject(PROJECT_SERVICE_TOKEN) private readonly projects?: Pick<ProjectService, 'getInfraManager'>,
  ) {
    this.logger = loggerModule.logger;
  }

  /** Every container of every stack on this machine, by container name. */
  private infraState(): Record<string, { status: string; health: string }> {
    const out: Record<string, { status: string; health: string }> = {};
    for (const { infra } of this.projects?.getInfraManager().listInstances() ?? []) {
      for (const [name, state] of Object.entries(infra.getState().services)) {
        out[name] = { status: state.status, health: containerHealth(state) };
      }
    }
    return out;
  }

  /**
   * Evaluate all enabled alert rules — once per scheduler tick. `now` is a
   * parameter for the court that walks a rule through its wait.
   */
  async evaluate(now: number = Date.now()): Promise<void> {
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
      const { firing, value, unparseable } = evaluateExpression(rule.expression, ctx);

      if (unparseable) {
        // Said once per cycle per rule rather than swallowed. An operator
        // wrote this rule to catch something; the platform is not catching
        // it, and no other surface would ever say so.
        this.logger.warn(
          { ruleId: rule.id, ruleName: rule.name, expression: rule.expression },
          'Alert rule expression cannot be evaluated — this rule will never fire'
        );
      }

      // Get current firing alert for this rule (if any)
      const currentAlert = await this.db
        .selectFrom('alert_events')
        .selectAll()
        .where('ruleId', '=', rule.id)
        .where('status', '=', 'firing')
        .executeTakeFirst();

      if (!firing) this.pendingSince.delete(rule.id);

      if (firing && !currentAlert) {
        // Held long enough? A rule with a wait fires only once its condition
        // has held for all of it, so a spike shorter than the wait is not paged.
        const waitMs = (rule.forDuration ?? 0) * 1000;
        if (waitMs > 0) {
          const since = this.pendingSince.get(rule.id) ?? now;
          this.pendingSince.set(rule.id, since);
          if (now - since < waitMs) continue;
        }
        this.pendingSince.delete(rule.id);
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

  /** A rule from fields `readAlertRuleFields` checked; what it watches is read off its expression. */
  async createRule(rule: AlertRuleFields): Promise<AlertRule> {
    const row = await this.db.insertInto('alert_rules').values({
      name: rule.name,
      expression: rule.expression,
      type: alertRuleTypeOf(rule.expression),
      severity: rule.severity,
      forDuration: rule.forDuration,
      annotations: rule.summary ? (JSON.stringify({ summary: rule.summary }) as any) : null,
      enabled: rule.enabled,
    } as any).returningAll().executeTakeFirstOrThrow();
    return mapRule(row);
  }

  /** Whatever the update carries, checked the same way; a new expression is a new type. */
  async updateRule(id: string, updates: Partial<AlertRuleFields>): Promise<AlertRule> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) set['name'] = updates.name;
    if (updates.expression !== undefined) {
      set['expression'] = updates.expression;
      set['type'] = alertRuleTypeOf(updates.expression);
    }
    if (updates.severity !== undefined) set['severity'] = updates.severity;
    if (updates.enabled !== undefined) set['enabled'] = updates.enabled;
    if (updates.forDuration !== undefined) set['forDuration'] = updates.forDuration;
    if (updates.summary !== undefined) {
      set['annotations'] = updates.summary ? JSON.stringify({ summary: updates.summary }) : null;
    }

    const row = await this.db.updateTable('alert_rules').set(set as any).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    // A condition that waited under the old rule proves nothing about the new one.
    this.pendingSince.delete(id);
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

  /**
   * Firing and acknowledged alerts, joined with their rule.
   *
   * Resolved events are excluded: this answers "what needs attention now".
   * The message prefers the rule's `summary` annotation and falls back to the
   * expression and the observed value, so an alert always renders as
   * something a human can act on.
   */
  async getActiveAlerts(limit = 100): Promise<ActiveAlert[]> {
    const rows = await this.db
      .selectFrom('alert_events')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_events.ruleId')
      .select([
        'alert_events.id as id',
        'alert_events.ruleId as ruleId',
        'alert_events.status as status',
        'alert_events.value as value',
        'alert_events.annotations as eventAnnotations',
        'alert_events.firedAt as firedAt',
        'alert_events.resolvedAt as resolvedAt',
        'alert_events.acknowledgedAt as acknowledgedAt',
        'alert_rules.name as ruleName',
        'alert_rules.severity as severity',
        'alert_rules.expression as expression',
        'alert_rules.annotations as ruleAnnotations',
      ])
      .where('alert_events.status', '=', 'firing')
      .orderBy('alert_events.firedAt', 'desc')
      .limit(limit)
      .execute();

    return rows.map((row) => {
      // Merged, not chosen.
      //
      // This was `eventAnnotations ?? ruleAnnotations`, so an event with ANY
      // annotations of its own lost every annotation its rule carried —
      // including `summary`, which is the sentence this list shows. An event
      // annotated `{node: …}` and nothing else would have rendered as the
      // raw expression, which is exactly what a replicated alert now looks
      // like: the master stamps the node it came from onto every one.
      //
      // The event's own values win where both have a key: the rule's
      // annotations are the template and the event's are what happened.
      const annotations = {
        ...((row.ruleAnnotations ?? {}) as Record<string, unknown>),
        ...((row.eventAnnotations ?? {}) as Record<string, unknown>),
      };
      const summary = typeof annotations['summary'] === 'string' ? (annotations['summary'] as string) : null;
      const node = typeof annotations['node'] === 'string' ? (annotations['node'] as string) : null;
      const value = row.value !== null && row.value !== undefined ? String(row.value) : null;

      return {
        id: String(row.id),
        ruleId: String(row.ruleId),
        ruleName: String(row.ruleName),
        severity: row.severity as AlertSeverity,
        message: summary ?? (value ? `${row.expression} (value: ${value})` : String(row.expression)),
        firedAt: new Date(row.firedAt as unknown as string).toISOString(),
        resolvedAt: row.resolvedAt ? new Date(row.resolvedAt as unknown as string).toISOString() : null,
        acknowledged: row.acknowledgedAt !== null && row.acknowledgedAt !== undefined,
        // Null for an alert this master raised about itself. Present for one
        // replicated from a node, which is the case where "disk above 90%"
        // is unactionable without it.
        node,
      };
    });
  }

  /**
   * Record who acknowledged a firing alert, and when. Only a firing one: a
   * resolved alert has nobody left to answer. And only the first time: the
   * moment it was taken, by whom, is the fact — a second click is not a
   * second taking.
   *
   * The acknowledger is the caller the RPC read from the session — it was a
   * field of the request, so anyone could sign an acknowledgement with
   * another operator's name. A console session is recorded by its account's
   * username; the CLI, admitted on the unix socket as `omnitron-local`, as
   * that — the audit trail's convention. Looked up by text, because
   * `omnitron-local` is no uuid and a uuid comparison would refuse the whole
   * acknowledgement over it.
   */
  async acknowledgeAlert(alertId: string, userId: string): Promise<boolean> {
    const user = await this.db
      .selectFrom('omnitron_users')
      .select('username')
      .where(sql<string>`${sql.ref('id')}::text`, '=', userId)
      .executeTakeFirst();
    const result = await this.db
      .updateTable('alert_events')
      .set({ acknowledgedAt: new Date(), acknowledgedBy: user?.username ?? userId } as any)
      .where('id', '=', alertId)
      .where('status', '=', 'firing')
      .where('acknowledgedAt', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0) > 0;
  }

  async getSummary(): Promise<AlertSummary> {
    const statusCounts = await this.db
      .selectFrom('alert_events')
      .select(['status'])
      .select((eb) => eb.fn.count<string>('id').as('count'))
      .select((eb) => eb.fn.count<string>('acknowledgedAt').as('acknowledged'))
      .groupBy('status')
      .execute();

    let firing = 0;
    let acknowledged = 0;
    let resolved = 0;
    let total = 0;
    for (const row of statusCounts) {
      const count = Number(row.count);
      total += count;
      if (row.status === 'firing') {
        firing = count;
        acknowledged = Number(row.acknowledged);
      } else if (row.status === 'resolved') {
        resolved = count;
      }
    }

    // Firing alerts by severity — every severity named, zero included.
    const bySeverity = Object.fromEntries(ALERT_SEVERITIES.map((s) => [s, 0])) as AlertSummary['bySeverity'];
    const severityCounts = await this.db
      .selectFrom('alert_events')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_events.ruleId')
      .select(['alert_rules.severity'])
      .select((eb) => eb.fn.count<string>('alert_events.id').as('count'))
      .where('alert_events.status', '=', 'firing')
      .groupBy('alert_rules.severity')
      .execute();
    for (const row of severityCounts) {
      if (row.severity in bySeverity) bySeverity[row.severity as keyof typeof bySeverity] = Number(row.count);
    }

    return { firing, acknowledged, resolved, total, bySeverity };
  }
}

// =============================================================================
// Mappers
// =============================================================================

function mapRule(row: any): AlertRule {
  const annotations = row.annotations
    ? typeof row.annotations === 'string'
      ? JSON.parse(row.annotations)
      : row.annotations
    : null;
  return {
    id: row.id,
    name: row.name,
    expression: row.expression,
    // Read off the expression: a row filed as `log` by the old form watched nothing.
    type: alertRuleTypeOf(row.expression) ?? row.type,
    severity: row.severity,
    forDuration: row.forDuration ?? null,
    summary: typeof annotations?.summary === 'string' ? annotations.summary : null,
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
